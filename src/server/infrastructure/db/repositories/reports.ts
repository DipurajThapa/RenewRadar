import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function annualValueSumSql() {
  return sql<number>`
    coalesce(
      sum(
        case
          when ${subscriptionsTable.billingCycle} = 'monthly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 12
          when ${subscriptionsTable.billingCycle} = 'quarterly'
            then ${subscriptionsTable.totalCostPerPeriodCents} * 4
          else ${subscriptionsTable.totalCostPerPeriodCents}
        end
      ),
      0
    )::int
  `;
}

function annualValueCentsSql() {
  return sql<number>`
    case
      when ${subscriptionsTable.billingCycle} = 'monthly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 12
      when ${subscriptionsTable.billingCycle} = 'quarterly'
        then ${subscriptionsTable.totalCostPerPeriodCents} * 4
      else ${subscriptionsTable.totalCostPerPeriodCents}
    end
  `;
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
        inArray(subscriptionsTable.status, ["active", "pending_cancellation"])
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
