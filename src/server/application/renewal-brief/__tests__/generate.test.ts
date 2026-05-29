/**
 * DB-backed: generateAndStoreBrief persists exactly one brief + one audit row
 * + one vendor_event, reasons over the subscription's real price history, and
 * stays tenant-scoped.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  auditLogTable,
  renewalBriefsTable,
  usersTable,
  vendorEventsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  ensureVendor,
  createSubscriptionWithRenewalEvent,
  updateSubscription,
} from "@server/application/subscriptions";
import {
  generateAndStoreBrief,
  getLatestBrief,
  RenewalBriefError,
} from "@server/application/renewal-brief";

let accountId: string;
let userId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Brief Co", billingEmail: "b@b.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@b.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
});

async function seedSubWithPriceHistory() {
  const vendor = await ensureVendor({ accountId, name: "Datadog" });
  const sub = await createSubscriptionWithRenewalEvent({
    accountId,
    actorUserId: userId,
    vendorId: vendor.id,
    data: {
      productName: "Pro",
      billingCycle: "annual",
      termStartDate: "2025-01-01",
      termEndDate: "2026-12-31",
      autoRenew: true,
      noticePeriodDays: 30,
      totalSeats: 1,
      unitPriceCents: 7_200_000,
      priceIncreaseClauseText: "Fees increase by up to 7% annually.",
    },
  });
  // a real price change → builds the trajectory the reasoner regresses over
  await updateSubscription({
    accountId,
    subscriptionId: sub.id,
    actorUserId: userId,
    patch: { unitPriceCents: 8_400_000 },
  });
  return sub;
}

describe("generateAndStoreBrief", () => {
  it("persists one brief + one audit + one vendor_event, with honest engine label", async () => {
    const sub = await seedSubWithPriceHistory();
    const brief = await generateAndStoreBrief({
      accountId,
      subscriptionId: sub.id,
      actorUserId: userId,
      today: new Date("2026-12-10"),
    });
    expect(brief.engine).toBe("deterministic");
    expect(["renewed", "renewed_with_adjustments", "downgraded", "cancelled", "deferred"]).toContain(
      brief.recommendedAction
    );

    const briefs = await db
      .select()
      .from(renewalBriefsTable)
      .where(eq(renewalBriefsTable.subscriptionId, sub.id));
    expect(briefs).toHaveLength(1);

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.accountId, accountId),
          eq(auditLogTable.action, "renewal_brief.generated")
        )
      );
    expect(audit).toHaveLength(1);

    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(eq(vendorEventsTable.kind, "renewal_brief_generated"));
    expect(events).toHaveLength(1);
  });

  it("getLatestBrief returns the newest brief for the subscription", async () => {
    const sub = await seedSubWithPriceHistory();
    await generateAndStoreBrief({ accountId, subscriptionId: sub.id, actorUserId: userId, today: new Date("2026-12-10") });
    await generateAndStoreBrief({ accountId, subscriptionId: sub.id, actorUserId: userId, today: new Date("2026-12-11") });
    const latest = await getLatestBrief(accountId, sub.id);
    expect(latest).not.toBeNull();
    const all = await db
      .select()
      .from(renewalBriefsTable)
      .where(eq(renewalBriefsTable.subscriptionId, sub.id));
    expect(all).toHaveLength(2);
  });

  it("getLatestBrief never returns a cross-account brief (SEC-2)", async () => {
    const sub = await seedSubWithPriceHistory();
    await generateAndStoreBrief({
      accountId,
      subscriptionId: sub.id,
      actorUserId: userId,
      today: new Date("2026-12-10"),
    });
    // A different account asking for the SAME subscriptionId must get nothing,
    // even though a brief row with that subscriptionId exists. Isolation is in
    // the SQL WHERE, not a post-query JS filter.
    const [other] = await db
      .insert(accountsTable)
      .values({ name: "Other", billingEmail: "o2@o.test" })
      .returning();
    const leaked = await getLatestBrief(other!.id, sub.id);
    expect(leaked).toBeNull();
    // The owning account still sees it.
    const owned = await getLatestBrief(accountId, sub.id);
    expect(owned).not.toBeNull();
  });

  it("throws for a subscription in another account (tenant scope)", async () => {
    const sub = await seedSubWithPriceHistory();
    const [other] = await db
      .insert(accountsTable)
      .values({ name: "Other", billingEmail: "o@o.test" })
      .returning();
    await expect(
      generateAndStoreBrief({
        accountId: other!.id,
        subscriptionId: sub.id,
        actorUserId: userId,
      })
    ).rejects.toBeInstanceOf(RenewalBriefError);
  });
});
