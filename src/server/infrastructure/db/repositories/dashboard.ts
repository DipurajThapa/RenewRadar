import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

// Audit-log reads moved to `./audit-log.ts`. Re-exported here for
// back-compat — existing call sites continue to work; new code should
// import from `@server/infrastructure/db/repositories/audit-log`.
export {
  getRecentActivity,
  listAuditEntries,
  listAuditEntityTypes,
} from "./audit-log";
export type {
  ActivityEntry,
  AuditLogEntry,
  AuditLogFilter,
} from "./audit-log";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!;
}

function addDaysToString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}

// Annualized cents — the single CASE both helpers below share.
//   monthly ×12, quarterly ×4, annual ×1.
//   multi_year: amortized over the actual term length (cost × 365 / term-days,
//     floored at a 1-year term) — treating a 3-year prepay as one year's spend
//     overstated annualized spend & "value at stake".
//   one_time: $0 — a one-off / perpetual purchase is not recurring annual spend.
function annualValueCase() {
  return sql`
    case
      when ${subscriptionsTable.billingCycle} = 'monthly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 12
      when ${subscriptionsTable.billingCycle} = 'quarterly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 4
      when ${subscriptionsTable.billingCycle} = 'annual'
        then ${subscriptionsTable.totalCostPerPeriodCents}
      when ${subscriptionsTable.billingCycle} = 'multi_year'
        then round(
          ${subscriptionsTable.totalCostPerPeriodCents} * 365.0
          / greatest(
              (${subscriptionsTable.termEndDate} - ${subscriptionsTable.termStartDate}),
              365
            )
        )
      when ${subscriptionsTable.billingCycle} = 'one_time'
        then 0
      else ${subscriptionsTable.totalCostPerPeriodCents}
    end
  `;
}

function annualValueCentsSql() {
  return sql<number>`${annualValueCase()}::int`;
}

function annualValueSumSql() {
  return sql<number>`coalesce(sum(${annualValueCase()}), 0)::int`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action band counts
// ─────────────────────────────────────────────────────────────────────────────

export type ActionBandCounts = {
  noticeDeadlinesActionWindow: number;
  renewalsAwaitingDecision: number;
  reclamationInactiveSeats: number; // V1.5 — always 0 in V1
};

export async function getActionBandCounts(
  accountId: string
): Promise<ActionBandCounts> {
  const today = todayUtc();
  const in7 = addDaysToString(today, 7);
  const in90 = addDaysToString(today, 90);

  const [noticeAction, renewalDecisions] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          inArray(renewalEventsTable.status, [
            "notice_window",
            "action_needed",
          ]),
          lte(renewalEventsTable.noticeDeadline, in7),
          gte(renewalEventsTable.noticeDeadline, today)
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          inArray(renewalEventsTable.status, [
            "upcoming",
            "notice_window",
            "action_needed",
          ]),
          lte(renewalEventsTable.renewalDate, in90),
          isNull(renewalEventsTable.decision)
        )
      ),
  ]);

  return {
    noticeDeadlinesActionWindow: noticeAction[0]?.count ?? 0,
    renewalsAwaitingDecision: renewalDecisions[0]?.count ?? 0,
    reclamationInactiveSeats: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI strip
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardKpis = {
  trackedSubscriptions: number;
  trackedSubscriptionsAddedThisMonth: number;
  noticeDeadlinesNext30Count: number;
  noticeDeadlinesNext30ValueCents: number;
  totalAnnualSpendCents: number;
  /**
   * PROJECTED saved this calendar year. Sum of `savedAnnualUsdCents` (what each
   * decision *aimed* to save) across savings records created this year. This is
   * an estimate, NOT money confirmed against actual post-renewal spend — never
   * present it on its own as "saved"; pair it with `provenSavedYtdAnnualUsdCents`.
   */
  savedYtdAnnualUsdCents: number;
  /**
   * PROVEN saved this calendar year. Sum of `realizedSavedAnnualUsdCents` across
   * savings records that the reconciliation cron has matched against actual
   * post-renewal spend (`reconciledAt` set). This is the honest "you really
   * saved this" number; it is ≤ projected until reconciliation catches up.
   */
  provenSavedYtdAnnualUsdCents: number;
  /**
   * Total saved across all time for this account. Used in the digest email
   * to show cumulative value created.
   */
  savedAllTimeAnnualUsdCents: number;
};

export async function getDashboardKpis(
  accountId: string
): Promise<DashboardKpis> {
  const today = todayUtc();
  const in30 = addDaysToString(today, 30);

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // Start of the current calendar year for "saved YTD".
  const startOfYear = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

  const [
    tracked,
    addedThisMonth,
    deadlines,
    totalSpend,
    savedYtd,
    provenSavedYtd,
    savedAllTime,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active")
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          // Active-only, to match `trackedSubscriptions` above — otherwise the
          // "+N this month" delta counts drafts/cancelled and can exceed the
          // tracked total it annotates (e.g. "5 tracked · +11 this month").
          eq(subscriptionsTable.status, "active"),
          gte(subscriptionsTable.createdAt, startOfMonth)
        )
      ),

    db
      .select({
        count: sql<number>`count(*)::int`,
        valueCents: annualValueSumSql(),
      })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.autoRenew, true),
          // Only OPEN, undecided deadlines are "at stake". An already-decided
          // event (status='processed' / decision set) must not inflate the
          // count or the $-at-stake total — it has been handled. Mirrors the
          // open-status filter used by the spotlight + action band.
          inArray(renewalEventsTable.status, [
            "upcoming",
            "notice_window",
            "action_needed",
          ]),
          isNull(renewalEventsTable.decision),
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in30)
        )
      ),

    db
      .select({ valueCents: annualValueSumSql() })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active")
        )
      ),

    // PROJECTED saved YTD — sum every savings_record's `savedAnnualUsdCents`
    // (what the decision aimed to save) created since Jan 1 this year.
    db
      .select({
        savedCents: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::bigint`,
      })
      .from(savingsRecordsTable)
      .where(
        and(
          eq(savingsRecordsTable.accountId, accountId),
          gte(savingsRecordsTable.createdAt, startOfYear)
        )
      ),

    // PROVEN saved YTD — sum only `realizedSavedAnnualUsdCents` for rows the
    // reconciliation cron has matched against actual post-renewal spend
    // (`reconciledAt` set). This is the honest "really saved" figure.
    db
      .select({
        savedCents: sql<number>`coalesce(sum(${savingsRecordsTable.realizedSavedAnnualUsdCents}), 0)::bigint`,
      })
      .from(savingsRecordsTable)
      .where(
        and(
          eq(savingsRecordsTable.accountId, accountId),
          gte(savingsRecordsTable.createdAt, startOfYear),
          sql`${savingsRecordsTable.reconciledAt} is not null`
        )
      ),

    // All-time savings — same query without the date filter; used by the
    // weekly digest's hero number ("you've saved $X total with Renewal Radar").
    db
      .select({
        savedCents: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::bigint`,
      })
      .from(savingsRecordsTable)
      .where(eq(savingsRecordsTable.accountId, accountId)),
  ]);

  return {
    trackedSubscriptions: tracked[0]?.count ?? 0,
    trackedSubscriptionsAddedThisMonth: addedThisMonth[0]?.count ?? 0,
    noticeDeadlinesNext30Count: deadlines[0]?.count ?? 0,
    noticeDeadlinesNext30ValueCents: deadlines[0]?.valueCents ?? 0,
    totalAnnualSpendCents: totalSpend[0]?.valueCents ?? 0,
    // `coalesce(sum(...))::bigint` comes back as a string from node-postgres
    // because JS numbers can't represent the full int64 range. We round-trip
    // through Number() because individual savings rows fit comfortably; if
    // a single account ever crosses ~$90T in savings we'll revisit.
    savedYtdAnnualUsdCents: Number(savedYtd[0]?.savedCents ?? 0),
    provenSavedYtdAnnualUsdCents: Number(provenSavedYtd[0]?.savedCents ?? 0),
    savedAllTimeAnnualUsdCents: Number(savedAllTime[0]?.savedCents ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notice Deadline Spotlight
// ─────────────────────────────────────────────────────────────────────────────

export type SpotlightRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  noticeDeadline: string;
  annualValueCents: number;
  status: string;
};

export async function getNoticeDeadlineSpotlight(
  accountId: string,
  limit = 5
): Promise<SpotlightRow[]> {
  const today = todayUtc();

  return db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      status: renewalEventsTable.status,
      annualValueCents: annualValueCentsSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.noticeDeadline, today),
        inArray(renewalEventsTable.status, [
          "upcoming",
          "notice_window",
          "action_needed",
        ])
      )
    )
    .orderBy(asc(renewalEventsTable.noticeDeadline))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Calendar Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type MonthBucket = {
  monthKey: string; // YYYY-MM
  count: number;
  totalValueCents: number;
};

export async function getRenewalCalendarSnapshot(
  accountId: string
): Promise<{ monthBuckets: MonthBucket[]; topThree: SpotlightRow[] }> {
  const today = todayUtc();
  const oneYearOut = addDaysToString(today, 365);

  const monthsRaw = await db
    .select({
      monthKey: sql<string>`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      totalValueCents: annualValueSumSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.renewalDate, today),
        lte(renewalEventsTable.renewalDate, oneYearOut)
      )
    )
    .groupBy(sql`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${renewalEventsTable.renewalDate}::date, 'YYYY-MM')`);

  const topThree = await db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      status: renewalEventsTable.status,
      annualValueCents: annualValueCentsSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active"),
        gte(renewalEventsTable.renewalDate, today)
      )
    )
    .orderBy(asc(renewalEventsTable.renewalDate))
    .limit(3);

  return { monthBuckets: monthsRaw, topThree };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomalies
// ─────────────────────────────────────────────────────────────────────────────

export type Anomaly =
  | { type: "auto_renew_no_decision"; count: number }
  | { type: "default_notice_period"; count: number };

export async function getAnomalies(accountId: string): Promise<Anomaly[]> {
  const today = todayUtc();
  const in30 = addDaysToString(today, 30);

  const [autoRenewMissing, defaultNoticeUsed] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(renewalEventsTable)
      .innerJoin(
        subscriptionsTable,
        eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
      )
      .where(
        and(
          eq(renewalEventsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.autoRenew, true),
          gte(renewalEventsTable.noticeDeadline, today),
          lte(renewalEventsTable.noticeDeadline, in30),
          isNull(renewalEventsTable.decision)
        )
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.accountId, accountId),
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.noticePeriodDays, 30)
        )
      ),
  ]);

  const anomalies: Anomaly[] = [];
  if ((autoRenewMissing[0]?.count ?? 0) > 0) {
    anomalies.push({
      type: "auto_renew_no_decision",
      count: autoRenewMissing[0]!.count,
    });
  }
  if ((defaultNoticeUsed[0]?.count ?? 0) > 0) {
    anomalies.push({
      type: "default_notice_period",
      count: defaultNoticeUsed[0]!.count,
    });
  }
  return anomalies;
}

// Audit-log queries moved to ./audit-log.ts and re-exported at the top of
// this file for back-compat. Dashboard is for KPIs + anomalies only.
