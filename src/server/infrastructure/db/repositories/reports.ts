import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

// Shared annualization CASE — monthly ×12, quarterly ×4, annual ×1,
// multi_year amortized over its term, one_time excluded ($0, non-recurring).
// Mirrors the dashboard repo so every annualized figure agrees.
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

function annualValueSumSql() {
  return sql<number>`coalesce(sum(${annualValueCase()}), 0)::int`;
}

function annualValueCentsSql() {
  return sql<number>`${annualValueCase()}::int`;
}

// ─── exposure ───────────────────────────────────────────────────────────────

export type ExposureBucket = {
  status: string;
  count: number;
  annualValueCents: number;
};

/**
 * Exposure rollup: how much annualized $ is in each renewal-event status?
 *
 * Buckets are limited to "live" (active subscription) rows. Cancelled and
 * expired subscriptions are intentionally excluded — they're past exposure.
 * Already-decided renewal events (decision set / status='processed') are also
 * excluded: exposure is forward-looking $ still at risk, and a handled renewal
 * is no longer exposure.
 */
export async function getExposureByStatus(
  accountId: string
): Promise<ExposureBucket[]> {
  return db
    .select({
      status: renewalEventsTable.status,
      count: sql<number>`count(*)::int`,
      annualValueCents: annualValueSumSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        inArray(subscriptionsTable.status, ["active", "pending_cancellation"]),
        isNull(renewalEventsTable.decision)
      )
    )
    .groupBy(renewalEventsTable.status);
}

// ─── upcoming exposure detail (for CSV) ─────────────────────────────────────

export type ExposureDetailRow = {
  renewalEventId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  status: string;
  renewalDate: string;
  noticeDeadline: string;
  annualValueCents: number;
};

export async function listExposureDetail(
  accountId: string,
  rangeDays = 365
): Promise<ExposureDetailRow[]> {
  const today = new Date().toISOString().split("T")[0]!;
  const cutoff = new Date(Date.now() + rangeDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  return db
    .select({
      renewalEventId: renewalEventsTable.id,
      subscriptionId: subscriptionsTable.id,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
      status: renewalEventsTable.status,
      renewalDate: renewalEventsTable.renewalDate,
      noticeDeadline: renewalEventsTable.noticeDeadline,
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
        // Forward-looking exposure only — exclude already-decided renewals.
        isNull(renewalEventsTable.decision),
        gte(renewalEventsTable.renewalDate, today),
        lte(renewalEventsTable.renewalDate, cutoff)
      )
    );
}

// ─── missed-deadline rollup ─────────────────────────────────────────────────

export type MissedDeadlineBucket = {
  monthKey: string;
  count: number;
  annualValueCents: number;
};

export async function getMissedDeadlinesByMonth(
  accountId: string,
  options: { sinceDate?: Date } = {}
): Promise<MissedDeadlineBucket[]> {
  const conditions = [
    eq(renewalEventsTable.accountId, accountId),
    eq(renewalEventsTable.status, "missed"),
  ];
  if (options.sinceDate) {
    conditions.push(
      gte(
        renewalEventsTable.noticeDeadline,
        options.sinceDate.toISOString().split("T")[0]!
      )
    );
  }

  return db
    .select({
      monthKey: sql<string>`to_char(${renewalEventsTable.noticeDeadline}::date, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      annualValueCents: annualValueSumSql(),
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(and(...conditions))
    .groupBy(sql`to_char(${renewalEventsTable.noticeDeadline}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${renewalEventsTable.noticeDeadline}::date, 'YYYY-MM')`);
}
