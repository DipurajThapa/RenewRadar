import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  renewalEventsTable,
  subscriptionsTable,
  usersTable,
  vendorsTable,
} from "@/lib/db/schema";
import type { Subscription, Vendor, RenewalEvent, User } from "@/lib/db/schema";

export type SubscriptionRow = {
  id: string;
  productName: string;
  planName: string | null;
  billingCycle: string;
  termEndDate: string;
  noticePeriodDays: number;
  totalSeats: number;
  totalCostPerPeriodCents: number;
  status: string;
  autoRenew: boolean;
  vendorName: string;
  vendorId: string;
  /** Owner info — null when no one has been assigned yet. */
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
};

/**
 * @param accountId  tenant scope
 * @param filters.ownerUserId  when set, only rows owned by this user; "unassigned" for rows with no owner
 */
export async function listSubscriptions(
  accountId: string,
  filters: { ownerUserId?: string | "unassigned" | null } = {}
): Promise<SubscriptionRow[]> {
  const conditions = [eq(subscriptionsTable.accountId, accountId)];
  if (filters.ownerUserId === "unassigned") {
    conditions.push(sql`${subscriptionsTable.ownerUserId} is null`);
  } else if (filters.ownerUserId) {
    conditions.push(eq(subscriptionsTable.ownerUserId, filters.ownerUserId));
  }

  return db
    .select({
      id: subscriptionsTable.id,
      productName: subscriptionsTable.productName,
      planName: subscriptionsTable.planName,
      billingCycle: subscriptionsTable.billingCycle,
      termEndDate: subscriptionsTable.termEndDate,
      noticePeriodDays: subscriptionsTable.noticePeriodDays,
      totalSeats: subscriptionsTable.totalSeats,
      totalCostPerPeriodCents: subscriptionsTable.totalCostPerPeriodCents,
      status: subscriptionsTable.status,
      autoRenew: subscriptionsTable.autoRenew,
      vendorName: vendorsTable.name,
      vendorId: vendorsTable.id,
      ownerUserId: subscriptionsTable.ownerUserId,
      ownerName: usersTable.fullName,
      ownerEmail: usersTable.workEmail,
    })
    .from(subscriptionsTable)
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(subscriptionsTable.ownerUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(asc(subscriptionsTable.termEndDate));
}

export type SubscriptionDetail = {
  subscription: Subscription;
  vendor: Vendor;
  renewalEvent: RenewalEvent | null;
  owner: Pick<User, "id" | "fullName" | "workEmail"> | null;
};

export async function getSubscriptionDetail(
  accountId: string,
  subscriptionId: string
): Promise<SubscriptionDetail | null> {
  const subRows = await db
    .select({
      subscription: subscriptionsTable,
      vendor: vendorsTable,
      ownerId: usersTable.id,
      ownerName: usersTable.fullName,
      ownerEmail: usersTable.workEmail,
    })
    .from(subscriptionsTable)
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .leftJoin(usersTable, eq(subscriptionsTable.ownerUserId, usersTable.id))
    .where(
      and(
        eq(subscriptionsTable.id, subscriptionId),
        eq(subscriptionsTable.accountId, accountId)
      )
    )
    .limit(1);

  if (!subRows[0]) return null;

  // Find the current open (un-decided) renewal event for this subscription.
  // Defense-in-depth: filter by accountId too, even though the prior query
  // already confirmed the subscription is in this account.
  const events = await db
    .select()
    .from(renewalEventsTable)
    .where(
      and(
        eq(renewalEventsTable.subscriptionId, subscriptionId),
        eq(renewalEventsTable.accountId, accountId)
      )
    )
    .orderBy(asc(renewalEventsTable.renewalDate))
    .limit(1);

  const { subscription, vendor, ownerId, ownerName, ownerEmail } = subRows[0];

  return {
    subscription,
    vendor,
    renewalEvent: events[0] ?? null,
    owner: ownerId
      ? { id: ownerId, fullName: ownerName, workEmail: ownerEmail ?? "" }
      : null,
  };
}

export async function countActiveSubscriptions(
  accountId: string
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.accountId, accountId),
        eq(subscriptionsTable.status, "active")
      )
    );
  return result[0]?.count ?? 0;
}
