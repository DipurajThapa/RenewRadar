import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  renewalEventsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@/lib/db/schema";
import {
  daysUntilNoticeDeadline,
} from "@/lib/notice-deadline/calculate";
import { annualizeCents } from "@/lib/billing/annualize";
import { scoreRisk, type RiskBand } from "@/lib/risk/score";

export type ActionQueueRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  planName: string | null;
  noticeDeadline: string;
  renewalDate: string;
  status: string;
  autoRenew: boolean;
  annualValueCents: number;
  daysUntilNoticeDeadline: number;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  risk: {
    score: number;
    band: RiskBand;
  };
};

/**
 * Composite action-queue query.
 *
 * Returns everything that needs a decision soon — explicit candidates and
 * score-elevated stragglers — in a single ranked list.
 *
 * Inclusion criteria (any of):
 *   - renewal_event.status ∈ {notice_window, action_needed, missed}, OR
 *   - notice_deadline within 60 days (so high-value or auto-renewing rows can
 *     be picked up by the risk scorer even before the state machine flips them).
 *
 * We post-filter by computed risk score in the application — pushing the
 * scoring into SQL would require duplicating the curves there and the row
 * counts at V1 scale (≤ 500 active subs per account) make this trivial.
 *
 * Ordering:
 *   1. status = "missed" rows first (no debate)
 *   2. then risk band: high → medium → low
 *   3. then earliest notice deadline
 */
export async function listActionQueueRows(
  accountId: string
): Promise<ActionQueueRow[]> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]!;
  const in60 = new Date(today);
  in60.setUTCDate(in60.getUTCDate() + 60);
  const in60Str = in60.toISOString().split("T")[0]!;

  const rows = await db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      planName: subscriptionsTable.planName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      renewalDate: renewalEventsTable.renewalDate,
      status: renewalEventsTable.status,
      autoRenew: subscriptionsTable.autoRenew,
      termEndDate: subscriptionsTable.termEndDate,
      noticePeriodDays: subscriptionsTable.noticePeriodDays,
      totalCostPerPeriodCents: subscriptionsTable.totalCostPerPeriodCents,
      billingCycle: subscriptionsTable.billingCycle,
      ownerUserId: subscriptionsTable.ownerUserId,
      ownerName: usersTable.fullName,
      ownerEmail: usersTable.workEmail,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(subscriptionsTable.ownerUserId, usersTable.id))
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        // Either we're in a "needs attention" state OR the notice deadline
        // is within 60 days (giving the risk scorer a chance to elevate).
        or(
          inArray(renewalEventsTable.status, [
            "notice_window",
            "action_needed",
            "missed",
          ]),
          and(
            gte(renewalEventsTable.noticeDeadline, sql`${todayStr}::date - interval '180 day'`),
            lte(renewalEventsTable.noticeDeadline, in60Str)
          )
        )
      )
    )
    .orderBy(asc(renewalEventsTable.noticeDeadline));

  // Score + finalize each row, then sort by (missed-first, band-rank, earliest-deadline).
  const scored: ActionQueueRow[] = rows.map((r) => {
    const annualValueCents = annualizeCents(
      r.totalCostPerPeriodCents,
      r.billingCycle
    );
    const days = daysUntilNoticeDeadline(
      r.termEndDate,
      r.noticePeriodDays,
      today
    );
    const risk = scoreRisk({
      daysUntilNoticeDeadline: days,
      annualValueCents,
      autoRenew: r.autoRenew,
      isMissed: r.status === "missed",
    });
    return {
      renewalEventId: r.renewalEventId,
      subscriptionId: r.subscriptionId,
      vendorName: r.vendorName,
      productName: r.productName,
      planName: r.planName,
      noticeDeadline: r.noticeDeadline,
      renewalDate: r.renewalDate,
      status: r.status,
      autoRenew: r.autoRenew,
      annualValueCents,
      daysUntilNoticeDeadline: days,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerName,
      ownerEmail: r.ownerEmail,
      risk: { score: risk.score, band: risk.band },
    };
  });

  // Drop low-band rows whose deadline is more than 60 days out — they're on
  // the schedule but don't belong in "this week's queue."
  const filtered = scored.filter(
    (r) => r.risk.band !== "low" || r.daysUntilNoticeDeadline <= 60
  );

  const bandRank: Record<RiskBand, number> = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => {
    if (a.status === "missed" && b.status !== "missed") return -1;
    if (b.status === "missed" && a.status !== "missed") return 1;
    const ba = bandRank[a.risk.band] - bandRank[b.risk.band];
    if (ba !== 0) return ba;
    return a.noticeDeadline.localeCompare(b.noticeDeadline);
  });

  return filtered;
}

export type ActionQueueRollup = {
  high: number;
  medium: number;
  low: number;
  totalAnnualValueAtRiskCents: number;
};

export function rollupActionQueue(rows: ActionQueueRow[]): ActionQueueRollup {
  const rollup: ActionQueueRollup = {
    high: 0,
    medium: 0,
    low: 0,
    totalAnnualValueAtRiskCents: 0,
  };
  for (const r of rows) {
    rollup[r.risk.band]++;
    rollup.totalAnnualValueAtRiskCents += r.annualValueCents;
  }
  return rollup;
}
