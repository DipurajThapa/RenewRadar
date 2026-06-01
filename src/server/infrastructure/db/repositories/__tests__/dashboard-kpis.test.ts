/**
 * getDashboardKpis — the "tracked subscriptions · +N this month" KPI.
 *
 * Regression guard: `trackedSubscriptionsAddedThisMonth` must count ACTIVE
 * subscriptions only, the same as `trackedSubscriptions`. Counting every status
 * let the "+N this month" delta exceed the tracked total it annotates
 * (e.g. "5 tracked · +11 this month"), which is logically impossible.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  subscriptionsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  ensureVendor,
  createSubscriptionWithRenewalEvent,
} from "@server/application/subscriptions";
import { getDashboardKpis } from "@server/infrastructure/db/repositories/dashboard";

let accountId: string;
let userId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "KPI Co", billingEmail: "k@k.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@k.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
});

async function makeSub(vendorName: string) {
  const vendor = await ensureVendor({ accountId, name: vendorName });
  return createSubscriptionWithRenewalEvent({
    accountId,
    actorUserId: userId,
    vendorId: vendor.id,
    data: {
      productName: "Plan",
      billingCycle: "annual",
      termStartDate: "2026-01-01",
      termEndDate: "2026-12-31",
      autoRenew: true,
      noticePeriodDays: 30,
      totalSeats: 1,
      unitPriceCents: 90_000,
    },
  });
}

describe("getDashboardKpis — added-this-month delta", () => {
  it("counts active subscriptions only, never exceeding the tracked total", async () => {
    await makeSub("Alpha"); // active, created this month
    const cancelled = await makeSub("Beta"); // created this month, then cancelled
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled" })
      .where(eq(subscriptionsTable.id, cancelled.id));

    const kpis = await getDashboardKpis(accountId);
    expect(kpis.trackedSubscriptions).toBe(1);
    // Was 2 before the fix (it counted the cancelled sub created this month).
    expect(kpis.trackedSubscriptionsAddedThisMonth).toBe(1);
    expect(kpis.trackedSubscriptionsAddedThisMonth).toBeLessThanOrEqual(
      kpis.trackedSubscriptions
    );
  });
});
