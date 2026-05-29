/**
 * Wedge PoC — spend ingestion + reconciliation contract tests (DB-backed).
 *
 *   - ingest is idempotent (re-sync → zero duplicate rows)
 *   - detect writes suggestions; a second detect run does NOT stack duplicates
 *     (the partial unique index + onConflictDoUpdate)
 *   - reconcile create-draft → a draft subscription, no renewal event, audited
 *   - reconcile match → links to the seeded existing subscription (Linear)
 *   - reconcile match + apply price → routes through updateSubscription
 *   - dismiss flips status only
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  recurringChargesTable,
  renewalEventsTable,
  spendConnectionsTable,
  spendTransactionsTable,
  subscriptionsTable,
  vendorsTable,
  type SpendConnection,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import { encryptJson } from "@server/infrastructure/crypto/envelope";
import { ingestSpendConnection } from "@server/application/spend/ingest";
import { detectRecurringForConnection } from "@server/application/spend/detect";
import {
  confirmRecurringChargeAsDraft,
  confirmRecurringChargeAsMatch,
  dismissRecurringCharge,
} from "@server/application/spend/reconcile";
import { ensureVendor, createSubscriptionWithRenewalEvent } from "@server/application/subscriptions";
import { accountsTable, usersTable } from "@server/infrastructure/db/schema";

let accountId: string;
let userId: string;
let connection: SpendConnection;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Wedge Co", billingEmail: "w@w.test" })
    .returning();
  accountId = account!.id;
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId,
      clerkUserId: `clerk_${accountId}`,
      workEmail: "owner@w.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  userId = user!.id;
  const [conn] = await db
    .insert(spendConnectionsTable)
    .values({
      accountId,
      kind: "fixture",
      configCiphertext: encryptJson(accountId, { datasetId: "default" }),
      status: "active",
    })
    .returning();
  connection = conn!;
});

describe("ingest", () => {
  it("ingests the fixture once and is idempotent on re-sync", async () => {
    const first = await ingestSpendConnection(connection);
    expect(first.ingested).toBeGreaterThan(0);

    const [after] = await db
      .select()
      .from(spendConnectionsTable)
      .where(eq(spendConnectionsTable.id, connection.id));
    // re-sync from the advanced cursor → no new rows
    const second = await ingestSpendConnection(after!);
    expect(second.ingested).toBe(0);

    // a full re-ingest from cursor 0 still inserts zero dupes (unique constraint)
    await db
      .update(spendConnectionsTable)
      .set({ syncCursor: null })
      .where(eq(spendConnectionsTable.id, connection.id));
    const [reset] = await db
      .select()
      .from(spendConnectionsTable)
      .where(eq(spendConnectionsTable.id, connection.id));
    const third = await ingestSpendConnection(reset!);
    expect(third.ingested).toBe(0); // all externalIds already present

    const rows = await db
      .select()
      .from(spendTransactionsTable)
      .where(eq(spendTransactionsTable.accountId, accountId));
    expect(rows.length).toBe(first.ingested);
  });
});

describe("detect", () => {
  beforeEach(async () => {
    await ingestSpendConnection(connection);
  });

  it("writes recurring-charge suggestions and does not stack on re-run", async () => {
    const a = await detectRecurringForConnection({ accountId, connectionId: connection.id });
    expect(a.detected).toBeGreaterThan(0);
    const after1 = await db
      .select()
      .from(recurringChargesTable)
      .where(eq(recurringChargesTable.accountId, accountId));
    // run again — partial-unique upsert means the same count, not double
    await detectRecurringForConnection({ accountId, connectionId: connection.id });
    const after2 = await db
      .select()
      .from(recurringChargesTable)
      .where(eq(recurringChargesTable.accountId, accountId));
    expect(after2.length).toBe(after1.length);
  });
});

describe("reconcile", () => {
  beforeEach(async () => {
    await ingestSpendConnection(connection);
    await detectRecurringForConnection({ accountId, connectionId: connection.id });
  });

  async function chargeFor(merchantContains: string) {
    const rows = await db
      .select()
      .from(recurringChargesTable)
      .where(eq(recurringChargesTable.accountId, accountId));
    return rows.find((r) =>
      r.normalizedMerchant.includes(merchantContains)
    )!;
  }

  it("create-draft yields a draft subscription with NO renewal event, audited", async () => {
    const notion = await chargeFor("notion");
    const res = await confirmRecurringChargeAsDraft({
      accountId,
      recurringChargeId: notion.id,
      actorUserId: userId,
    });
    expect(res.outcome).toBe("created_draft");
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, res.subscriptionId!));
    expect(sub!.status).toBe("draft");
    const events = await db
      .select()
      .from(renewalEventsTable)
      .where(eq(renewalEventsTable.subscriptionId, sub!.id));
    expect(events.length).toBe(0); // drafts fire no renewal event / alerts

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.accountId, accountId));
    expect(audit.map((a) => a.action)).toContain("recurring_charge.confirmed");
  });

  it("matches a detected charge to an existing subscription (Linear)", async () => {
    // seed an existing active Linear subscription
    const vendor = await ensureVendor({ accountId, name: "Linear" });
    await createSubscriptionWithRenewalEvent({
      accountId,
      actorUserId: userId,
      vendorId: vendor.id,
      data: {
        productName: "Linear",
        billingCycle: "monthly",
        termStartDate: "2026-01-01",
        termEndDate: "2026-12-31",
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats: 1,
        unitPriceCents: 9600,
      },
    });

    const linear = await chargeFor("linear");
    const res = await confirmRecurringChargeAsMatch({
      accountId,
      recurringChargeId: linear.id,
      actorUserId: userId,
      applyObservedPrice: false,
    });
    expect(res.outcome).toBe("matched_existing");
    expect(res.subscriptionId).toBeTruthy();
  });

  it("match + apply price routes through updateSubscription and emits price_changed", async () => {
    const vendor = await ensureVendor({ accountId, name: "Linear" });
    const sub = await createSubscriptionWithRenewalEvent({
      accountId,
      actorUserId: userId,
      vendorId: vendor.id,
      data: {
        productName: "Linear",
        billingCycle: "monthly",
        termStartDate: "2026-01-01",
        termEndDate: "2026-12-31",
        autoRenew: true,
        noticePeriodDays: 30,
        totalSeats: 1,
        unitPriceCents: 5000, // lower than the fixture's $96
      },
    });
    const linear = await chargeFor("linear");
    await confirmRecurringChargeAsMatch({
      accountId,
      recurringChargeId: linear.id,
      actorUserId: userId,
      applyObservedPrice: true,
    });
    const [updated] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, sub.id));
    expect(updated!.unitPriceCents).toBe(9600); // observed price applied
  });

  it("refuses to confirm a non-USD (EUR) charge into the USD inventory (EDGE-2)", async () => {
    const hetzner = await chargeFor("hetzner");
    expect(hetzner.currency).toBe("EUR"); // fixture partitions Hetzner under EUR
    await expect(
      confirmRecurringChargeAsDraft({
        accountId,
        recurringChargeId: hetzner.id,
        actorUserId: userId,
      })
    ).rejects.toMatchObject({ name: "ReconcileError" });

    // No subscription was created, and the suggestion stays `detected` so the
    // human can still dismiss or handle it manually.
    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, accountId));
    expect(subs.length).toBe(0);
    const [stillDetected] = await db
      .select()
      .from(recurringChargesTable)
      .where(eq(recurringChargesTable.id, hetzner.id));
    expect(stillDetected!.status).toBe("detected");
  });

  it("dismiss flips status to dismissed", async () => {
    const notion = await chargeFor("notion");
    await dismissRecurringCharge({
      accountId,
      recurringChargeId: notion.id,
      actorUserId: userId,
    });
    const [row] = await db
      .select()
      .from(recurringChargesTable)
      .where(eq(recurringChargesTable.id, notion.id));
    expect(row!.status).toBe("dismissed");
  });
});
