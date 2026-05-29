/**
 * A2 — reconcileSavingsRecord (DB-backed). Matches a projected saving against
 * the actual post-renewal charge from the spend feed and marks it realized |
 * variance | not_observed. Idempotent; works additively on a locked row.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  auditLogTable,
  recurringChargesTable,
  savingsRecordsTable,
  spendConnectionsTable,
  usersTable,
  vendorEventsTable,
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
import { reconcileSavingsRecord } from "@server/application/savings/reconcile";

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
    .values({ name: "ROI Co", billingEmail: "r@r.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@r.test",
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
  const { renewalEventsTable } = await import("@server/infrastructure/db/schema");
  const [ev] = await db
    .select()
    .from(renewalEventsTable)
    .where(eq(renewalEventsTable.subscriptionId, sub.id))
    .limit(1);
  renewalEventId = ev!.id;
});

/** A projected savings row whose decision predates the post-renewal charge. */
async function makeSavings(opts: {
  baseline: number;
  projectedSaved: number;
  lockedAt?: Date | null;
}) {
  const [row] = await db
    .insert(savingsRecordsTable)
    .values({
      accountId,
      renewalEventId,
      subscriptionId,
      kind: "renegotiated",
      baselineAnnualUsdCents: opts.baseline,
      newAnnualUsdCents: opts.baseline - opts.projectedSaved,
      savedAnnualUsdCents: opts.projectedSaved,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      expectedSavingsRealizedAt: new Date("2026-02-01T00:00:00Z"),
      lockedAt: opts.lockedAt ?? null,
    })
    .returning();
  return row!;
}

/** A confirmed recurring charge linked to the sub, latest amount = monthly $. */
async function makeConfirmedCharge(latestMonthlyCents: number, lastChargedOn: string) {
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
    typicalAmountCents: latestMonthlyCents,
    latestAmountCents: latestMonthlyCents,
    confidence: 90,
    sampleSize: 6,
    firstChargedOn: "2026-01-15",
    lastChargedOn,
    status: "confirmed",
    subscriptionId,
    reviewedByUserId: userId,
    reviewedAt: new Date(),
  });
}

const NOW = new Date("2026-06-01T00:00:00Z");

describe("reconcileSavingsRecord", () => {
  it("marks realized when the actual post-renewal price matches the projection", async () => {
    const rec = await makeSavings({ baseline: 600_000, projectedSaved: 120_000 });
    await makeConfirmedCharge(40_000, "2026-05-01"); // $40k/yr → saved $120k
    const res = await reconcileSavingsRecord({
      accountId,
      savingsRecordId: rec.id,
      now: NOW,
    });
    expect(res.status).toBe("realized");
    const [after] = await db
      .select()
      .from(savingsRecordsTable)
      .where(eq(savingsRecordsTable.id, rec.id));
    expect(after!.realizedSavedAnnualUsdCents).toBe(120_000);
    expect(after!.reconciledAt).not.toBeNull();
    // audit + vendor event written
    const audit = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.accountId, accountId),
          eq(auditLogTable.action, "savings_record.reconciled")
        )
      );
    expect(audit).toHaveLength(1);
    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(eq(vendorEventsTable.kind, "savings_realized"));
    expect(events).toHaveLength(1);
  });

  it("marks variance when the negotiated price didn't stick", async () => {
    const rec = await makeSavings({ baseline: 600_000, projectedSaved: 120_000 });
    await makeConfirmedCharge(55_000, "2026-05-01"); // $660k/yr → saved $0
    const res = await reconcileSavingsRecord({
      accountId,
      savingsRecordId: rec.id,
      now: NOW,
    });
    expect(res.status).toBe("variance");
    const [after] = await db
      .select()
      .from(savingsRecordsTable)
      .where(eq(savingsRecordsTable.id, rec.id));
    expect(after!.realizedSavedAnnualUsdCents).toBe(0);
  });

  it("stays not_observed (no write) when no post-renewal charge exists", async () => {
    const rec = await makeSavings({ baseline: 600_000, projectedSaved: 120_000 });
    // no confirmed charge at all
    const res = await reconcileSavingsRecord({
      accountId,
      savingsRecordId: rec.id,
      now: NOW,
    });
    expect(res.status).toBe("not_observed");
    const [after] = await db
      .select()
      .from(savingsRecordsTable)
      .where(eq(savingsRecordsTable.id, rec.id));
    expect(after!.reconciledAt).toBeNull(); // will retry next cron
    expect(after!.realizedSavedAnnualUsdCents).toBeNull();
  });

  it("is idempotent — a second pass on a reconciled row is a no-op", async () => {
    const rec = await makeSavings({ baseline: 600_000, projectedSaved: 120_000 });
    await makeConfirmedCharge(40_000, "2026-05-01");
    await reconcileSavingsRecord({ accountId, savingsRecordId: rec.id, now: NOW });
    await reconcileSavingsRecord({ accountId, savingsRecordId: rec.id, now: NOW });
    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "savings_record.reconciled"));
    expect(audit).toHaveLength(1); // not 2
  });

  it("reconciles a LOCKED row additively without touching projected columns", async () => {
    const rec = await makeSavings({
      baseline: 600_000,
      projectedSaved: 120_000,
      lockedAt: new Date("2026-02-01T00:00:00Z"),
    });
    await makeConfirmedCharge(40_000, "2026-05-01");
    await reconcileSavingsRecord({ accountId, savingsRecordId: rec.id, now: NOW });
    const [after] = await db
      .select()
      .from(savingsRecordsTable)
      .where(eq(savingsRecordsTable.id, rec.id));
    // projected columns unchanged…
    expect(after!.savedAnnualUsdCents).toBe(120_000);
    expect(after!.lockedAt).not.toBeNull();
    // …realized columns filled.
    expect(after!.realizedSavedAnnualUsdCents).toBe(120_000);
    expect(after!.reconciliationStatus).toBe("realized");
  });
});
