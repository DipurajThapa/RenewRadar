import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  renewalEventsTable,
  subscriptionsTable,
  vendorsTable,
} from "@/lib/db/schema";

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
