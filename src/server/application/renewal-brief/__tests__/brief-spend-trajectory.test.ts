/**
 * A1 — the moat: the Renewal Intelligence Brief reasons over the REAL charge
 * series from the auto-ingested spend feed, not just contract events. When a
 * confirmed recurring charge is linked to a subscription, its per-period
 * transactions fold into the brief's price-trajectory input as `spend_feed`
 * points, so the price_trajectory pass fires with a predicted next renewal.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  recurringChargesTable,
  spendConnectionsTable,
  spendTransactionsTable,
  subscriptionsTable,
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

  it("drops merchant charges an order of magnitude off the contract value", async () => {
    // The $500/mo plan ($6,000/yr anchor) plus a $7,000 platform charge that
    // shares the same merchant — a different line item. It annualizes to
    // $84,000/yr (14× the anchor) and must NOT be folded into THIS
    // subscription's trajectory, or it would blow up the projection.
    const sub = await seedSubWithSpendSeries();
    const [conn] = await db
      .select()
      .from(spendConnectionsTable)
      .where(eq(spendConnectionsTable.accountId, accountId));
    await db.insert(spendTransactionsTable).values({
      accountId,
      connectionId: conn!.id,
      externalId: "datadog-contaminant",
      rawMerchant: "DATADOG INC",
      normalizedMerchant: "datadog",
      amountCents: 700_000, // $7,000 one-off platform charge
      currency: "USD",
      chargedOn: "2026-05-15",
      status: "grouped",
    });

    const input = await buildRenewalBriefInput(
      accountId,
      sub.id,
      new Date("2026-06-01")
    );
    const feed = input!.chargeHistory.filter((c) => c.source === "spend_feed");
    // the six in-band charges remain; the $84k/yr contaminant is excluded
    expect(feed.length).toBe(6);
    expect(feed.every((p) => p.totalAnnualizedCents < 1_000_000)).toBe(true);
  });

  it("takes notice urgency from the active renewal event, not a stale sub term", async () => {
    // Repro of the brief's negative-days bug: the renewal event tracks the
    // upcoming cycle (deadline 2026-06-03), but the subscription's termEndDate
    // still points at the prior cycle. The brief must read the event's deadline
    // (4 days out) — not the stale term (which would compute a negative count).
    const vendor = await ensureVendor({ accountId, name: "Notion" });
    const sub = await createSubscriptionWithRenewalEvent({
      accountId,
      actorUserId: userId,
      vendorId: vendor.id,
      data: {
        productName: "Plus",
        billingCycle: "annual",
        termStartDate: "2025-07-03",
        termEndDate: "2026-07-03",
        autoRenew: true,
        noticePeriodDays: 30, // → event notice deadline 2026-06-03
        totalSeats: 1,
        unitPriceCents: 90_000,
      },
    });
    // Stale term: never rolled forward — its derived deadline is ~a year ago.
    await db
      .update(subscriptionsTable)
      .set({ termEndDate: "2025-07-03" })
      .where(eq(subscriptionsTable.id, sub.id));

    const input = await buildRenewalBriefInput(
      accountId,
      sub.id,
      new Date("2026-05-30")
    );
    expect(input).not.toBeNull();
    expect(input!.daysUntilNoticeDeadline).toBe(4); // from the event, not -361
    expect(input!.daysUntilNoticeDeadline).toBeGreaterThan(0);
  });
});
