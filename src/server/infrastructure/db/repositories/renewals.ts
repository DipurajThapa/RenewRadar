import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  renewalBriefsTable,
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

/**
 * CRON-ONLY cross-account read for the autonomous Renewal Agent. Returns
 * (accountId, subscriptionId) pairs whose renewal event has entered its notice
 * window / action-needed state, whose account hasn't switched the agent off
 * (agentAutoPrep), and which have NOT been prepped yet (no brief exists). Each
 * pair is re-scoped by its own accountId in the agent loop. Never call from a
 * request path.
 */
export async function listSubscriptionsNeedingAutoPrep(): Promise<
  Array<{ accountId: string; subscriptionId: string }>
> {
  return db
    .selectDistinct({
      accountId: renewalEventsTable.accountId,
      subscriptionId: renewalEventsTable.subscriptionId,
    })
    .from(renewalEventsTable)
    .innerJoin(accountsTable, eq(accountsTable.id, renewalEventsTable.accountId))
    .leftJoin(
      renewalBriefsTable,
      eq(renewalBriefsTable.subscriptionId, renewalEventsTable.subscriptionId)
    )
    .where(
      and(
        inArray(renewalEventsTable.status, ["notice_window", "action_needed"]),
        eq(accountsTable.agentAutoPrep, true),
        isNull(renewalBriefsTable.id)
      )
    );
}

export type AgentPreppedItem = {
  subscriptionId: string;
  vendorName: string;
  productName: string;
  recommendedAction: string;
  confidencePct: number;
  noticeDeadline: string;
  preppedAt: Date;
};

/**
 * The autonomous Renewal Agent's silent output, surfaced for the dashboard
 * "Prepared for you" rollup. Returns briefs the agent prepped
 * (`createdByUserId IS NULL`) for renewal events that are STILL open
 * (notice_window / action_needed) — i.e. work that's ready and still needs the
 * human. accountId-first scoping; soonest deadline first.
 */
export async function listAgentPreppedItems(
  accountId: string,
  limit = 6
): Promise<AgentPreppedItem[]> {
  // A subscription can have many briefs (re-prep, regeneration). The
  // "Prepared for you" rollup is ONE row per subscription, showing the most
  // recent agent-prepped brief — anything else is a duplicate (and produced a
  // React duplicate-key warning + double rows in the UI).
  const rows = await db.execute<{
    subscription_id: string;
    vendor_name: string;
    product_name: string;
    recommended_action: AgentPreppedItem["recommendedAction"];
    confidence_pct: number;
    notice_deadline: string;
    prepped_at: Date;
  }>(sql`
    select distinct on (b.subscription_id)
      b.subscription_id  as subscription_id,
      v.name             as vendor_name,
      s.product_name     as product_name,
      b.recommended_action as recommended_action,
      b.confidence_pct   as confidence_pct,
      re.notice_deadline as notice_deadline,
      b.created_at       as prepped_at
    from renewal_brief b
    inner join renewal_event re on re.id = b.renewal_event_id
    inner join subscription s   on s.id = b.subscription_id
    inner join vendor v         on v.id = s.vendor_id
    where b.account_id = ${accountId}
      and b.created_by_user_id is null
      and re.status in ('notice_window', 'action_needed')
    order by b.subscription_id, b.created_at desc
    limit ${limit}
  `);
  // Drizzle's `db.execute` returns RowList; map to our typed shape.
  return rows.map((r) => ({
    subscriptionId: r.subscription_id,
    vendorName: r.vendor_name,
    productName: r.product_name,
    recommendedAction: r.recommended_action,
    confidencePct: r.confidence_pct,
    noticeDeadline: r.notice_deadline,
    preppedAt: r.prepped_at,
  }));
}

export type RenewalRange = 30 | 90 | 180 | 365;

export type RenewalCalendarRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  planName: string | null;
  renewalDate: string;
  noticeDeadline: string;
  status: string;
  decision: string | null;
  annualValueCents: number;
};

export async function listRenewalsInRange(
  accountId: string,
  rangeDays: RenewalRange
): Promise<RenewalCalendarRow[]> {
  const today = new Date().toISOString().split("T")[0]!;
  const cutoff = addDays(today, rangeDays);

  return db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      planName: subscriptionsTable.planName,
      renewalDate: renewalEventsTable.renewalDate,
      noticeDeadline: renewalEventsTable.noticeDeadline,
      status: renewalEventsTable.status,
      decision: renewalEventsTable.decision,
      annualValueCents: sql<number>`
        case
          when ${subscriptionsTable.billingCycle} = 'monthly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 12
          when ${subscriptionsTable.billingCycle} = 'quarterly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 4
          else ${subscriptionsTable.totalCostPerPeriodCents}
        end
      `,
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
        gte(renewalEventsTable.renewalDate, today),
        lte(renewalEventsTable.renewalDate, cutoff)
      )
    )
    .orderBy(asc(renewalEventsTable.renewalDate));
}

export async function getRenewalEventWithContext(
  accountId: string,
  renewalEventId: string
) {
  const result = await db
    .select({
      renewalEvent: renewalEventsTable,
      subscription: subscriptionsTable,
      vendor: vendorsTable,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(renewalEventsTable.id, renewalEventId),
        eq(renewalEventsTable.accountId, accountId)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}
