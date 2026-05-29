/**
 * A1 — the moat: the Renewal Intelligence Brief reasons over the REAL charge
 * series from the auto-ingested spend feed, not just contract events. When a
 * confirmed recurring charge is linked to a subscription, its per-period
 * transactions fold into the brief's price-trajectory input as `spend_feed`
 * points, so the price_trajectory pass fires with a predicted next renewal.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  recurringChargesTable,
  spendConnectionsTable,
  spendTransactionsTable,
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
import { buildRenewalBriefInput } from "@server/application/renewal-brief/aggregate";
import { generateAndStoreBrief } from "@server/application/renewal-brief";
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";

let accountId: string;
let userId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Moat Co", billingEmail: "m@m.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@m.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
});

/** A monthly subscription with a confirmed spend charge whose transactions step
 *  $500 → $560/mo over six months. */
async function seedSubWithSpendSeries() {
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
  const [conn] = await db
    .insert(spendConnectionsTable)
    .values({
      accountId,
      kind: "fixture",
      configCiphertext: encryptJson(accountId, { datasetId: "default" }),
      status: "active",
    })
    .returning();
  const amounts = [50_000, 50_000, 50_000, 56_000, 56_000, 56_000];
  const dates = [
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
  ];
  for (let i = 0; i < amounts.length; i++) {
    await db.insert(spendTransactionsTable).values({
      accountId,
      connectionId: conn!.id,
      externalId: `datadog-${i}`,
      rawMerchant: "DATADOG INC",
      normalizedMerchant: "datadog",
      amountCents: amounts[i]!,
      currency: "USD",
      chargedOn: dates[i]!,
      status: "grouped",
    });
  }
  await db.insert(recurringChargesTable).values({
    accountId,
    connectionId: conn!.id,
    normalizedMerchant: "datadog",
    currency: "USD",
    suggestedVendorName: "Datadog",
    detectedCycle: "monthly",
    typicalAmountCents: 53_000,
    latestAmountCents: 56_000,
    amountDriftPct: 12,
    confidence: 90,
    sampleSize: 6,
    firstChargedOn: "2025-12-01",
    lastChargedOn: "2026-05-01",
    status: "confirmed",
    subscriptionId: sub.id,
    reviewedByUserId: userId,
    reviewedAt: new Date(),
  });
  return sub;
}

describe("brief reasons over the spend feed (A1)", () => {
  it("folds confirmed spend-feed charges into the trajectory input", async () => {
    const sub = await seedSubWithSpendSeries();
    const input = await buildRenewalBriefInput(accountId, sub.id, new Date("2026-06-01"));
    expect(input).not.toBeNull();
    const feedPoints = input!.chargeHistory.filter((c) => c.source === "spend_feed");
    expect(feedPoints.length).toBe(6); // all six monthly charges
    // sorted oldest → newest, and the step is visible (annualized 600k → 672k)
    expect(input!.chargeHistory).toEqual(
      [...input!.chargeHistory].sort((a, b) =>
        a.effectiveDate < b.effectiveDate ? -1 : 1
      )
    );
    expect(feedPoints[feedPoints.length - 1]!.totalAnnualizedCents).toBe(672_000);
  });

  it("fires a price_trajectory claim with a predicted next renewal", async () => {
    const sub = await seedSubWithSpendSeries();
    const row = await generateAndStoreBrief({
      accountId,
      subscriptionId: sub.id,
      actorUserId: userId,
      today: new Date("2026-06-01"),
    });
    const brief = row.briefJson as RenewalIntelligenceBrief;
    const keys = brief.claims.map((c) => c.key);
    expect(keys).toContain("price_trajectory");
    expect(brief.predictedNextAnnualCents).not.toBeNull();
    expect(brief.predictedNextAnnualCents!.point).toBeGreaterThan(600_000);
  });
});
