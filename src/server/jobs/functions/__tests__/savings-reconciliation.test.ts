/**
 * A2 — savings-reconciliation cron: reconciles only records whose realization
 * date has passed and that aren't already reconciled.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  recurringChargesTable,
  renewalEventsTable,
  savingsRecordsTable,
  spendConnectionsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import { encryptJson } from "@server/infrastructure/crypto/envelope";
import {
  ensureVendor,
  createSubscriptionWithRenewalEvent,
} from "@server/application/subscriptions";
import { runSavingsReconciliation } from "@server/jobs/functions/savings-reconciliation";

let accountId: string;
let userId: string;
let subscriptionId: string;
let renewalEventId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Cron Co", billingEmail: "c@c.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "o@c.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
  const vendor = await ensureVendor({ accountId, name: "Datadog" });
  const sub = await createSubscriptionWithRenewalEvent({
    accountId,
    actorUserId: userId,
    vendorId: vendor.id,
    data: {
      productName: "Pro",
      billingCycle: "monthly",
      termStartDate: "2025-12-01",
      termEndDate: "2026-12-31",
      autoRenew: true,
      noticePeriodDays: 30,
      totalSeats: 1,
      unitPriceCents: 50_000,
    },
  });
  subscriptionId = sub.id;
  const [ev] = await db
    .select()
    .from(renewalEventsTable)
    .where(eq(renewalEventsTable.subscriptionId, sub.id))
    .limit(1);
  renewalEventId = ev!.id;

  // a confirmed post-renewal charge ($40k/yr → saved $120k)
  const [conn] = await db
    .insert(spendConnectionsTable)
    .values({
      accountId,
      kind: "fixture",
      configCiphertext: encryptJson(accountId, { datasetId: "default" }),
      status: "active",
    })
    .returning();
  await db.insert(recurringChargesTable).values({
    accountId,
    connectionId: conn!.id,
    normalizedMerchant: "datadog",
    currency: "USD",
    suggestedVendorName: "Datadog",
    detectedCycle: "monthly",
    typicalAmountCents: 40_000,
    latestAmountCents: 40_000,
    confidence: 90,
    sampleSize: 6,
    firstChargedOn: "2026-01-15",
    lastChargedOn: "2026-05-01",
    status: "confirmed",
    subscriptionId,
    reviewedByUserId: userId,
    reviewedAt: new Date(),
  });
});

const passThrough = <T>(_id: string, fn: () => Promise<T>) => fn();
const NOW = new Date("2026-06-01T00:00:00Z");

async function makeSavings(expectedAt: Date) {
  await db.insert(savingsRecordsTable).values({
    accountId,
    renewalEventId,
    subscriptionId,
    kind: "renegotiated",
    baselineAnnualUsdCents: 600_000,
    newAnnualUsdCents: 480_000,
    savedAnnualUsdCents: 120_000,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expectedSavingsRealizedAt: expectedAt,
  });
}

describe("runSavingsReconciliation cron", () => {
  it("reconciles a due record and skips a not-yet-due one", async () => {
    await makeSavings(new Date("2026-02-01T00:00:00Z")); // due (past)
    const res = await runSavingsReconciliation(passThrough, NOW);
    expect(res.due).toBe(1);
    expect(res.realized).toBe(1);
  });

  it("does not pick up records whose realization date is in the future", async () => {
    await makeSavings(new Date("2027-01-01T00:00:00Z")); // not due yet
    const res = await runSavingsReconciliation(passThrough, NOW);
    expect(res.due).toBe(0);
  });
});
