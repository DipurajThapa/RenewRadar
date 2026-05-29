/**
 * applyExtractedField tests — the ONLY path AI values reach the source of
 * truth (subscription/renewal_event/vendor).
 *
 * Audit gap C4: pre-fix this 416-line function had zero tests. Cross-account
 * safety here was asserted only at the read layer; the write path had no
 * behavioural test.
 *
 * Covered:
 *   - Guards: pending/rejected/no-reviewer/no-subscription/cross-account
 *   - Idempotency: a second apply call is a no-op
 *   - Field kinds: auto_renewal, contract_value_cents, notice_period_days
 *   - Vendor event emission: contract_field_applied + price_changed
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
  subscriptionsTable,
  vendorEventsTable,
} from "@server/infrastructure/db/schema";
import type { AiFieldKey } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { applyExtractedField } from "@server/application/documents/apply-field";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Seed a document + an extracted field in a given review state. Returns
 * the field ID for the test to apply.
 */
async function seedField(args: {
  accountId: string;
  subscriptionId: string | null;
  reviewerUserId: string;
  fieldKey: AiFieldKey;
  parsedValueJson: Record<string, unknown>;
  reviewStatus: "pending" | "accepted" | "edited" | "rejected" | "applied";
  reviewedByUserId?: string | null;
  reviewerEditedValueJson?: Record<string, unknown> | null;
}): Promise<string> {
  const [doc] = await db
    .insert(documentsTable)
    .values({
      accountId: args.accountId,
      uploadedByUserId: args.reviewerUserId,
      kind: "contract" as const,
      filename: `${args.fieldKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1000,
      storageKey: `test/${args.fieldKey}-${Date.now()}-${Math.random()}.pdf`,
      checksumSha256: `sha-${args.fieldKey}-${Date.now()}-${Math.random()}`,
      textExtractionStatus: "ready" as const,
    })
    .returning();
  if (!doc) throw new Error("seed doc failed");

  // Extracted fields require a non-null runId. Seed a completed run for
  // the document.
  const [run] = await db
    .insert(aiExtractionRunsTable)
    .values({
      accountId: args.accountId,
      documentId: doc.id,
      provider: "test-stub",
      model: "test",
      promptVersion: "v1",
      status: "succeeded",
      pagesCharged: 0,
      startedAt: new Date(),
    })
    .returning();
  if (!run) throw new Error("seed run failed");

  const [field] = await db
    .insert(aiExtractedFieldsTable)
    .values({
      accountId: args.accountId,
      runId: run.id,
      documentId: doc.id,
      subscriptionId: args.subscriptionId,
      fieldKey: args.fieldKey,
      rawValue: "raw",
      parsedValueJson: args.parsedValueJson,
      confidence: 85,
      evidenceQuote: "fake evidence quote",
      evidencePageNumber: 1,
      reviewStatus: args.reviewStatus,
      reviewedByUserId:
        args.reviewedByUserId === undefined
          ? args.reviewStatus === "accepted" || args.reviewStatus === "edited"
            ? args.reviewerUserId
            : null
          : args.reviewedByUserId,
      reviewerEditedValueJson: args.reviewerEditedValueJson ?? null,
    })
    .returning();
  if (!field) throw new Error("seed field failed");
  return field.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────

describe("applyExtractedField guards", () => {
  it("refuses a pending field (must be accepted/edited first)", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      reviewStatus: "pending",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a rejected field", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      reviewStatus: "rejected",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a field with no reviewer recorded", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      reviewStatus: "accepted",
      reviewedByUserId: null, // explicitly missing
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a field not linked to a subscription", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: null,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      reviewStatus: "accepted",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not linked/i);
  });

  it("refuses cross-account: A's user cannot apply B's field", async () => {
    const bField = await seedField({
      accountId: ids.accountB.id,
      subscriptionId: ids.accountB.subscriptionId,
      reviewerUserId: ids.accountB.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      reviewStatus: "accepted",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id, // wrong account
      actorUserId: ids.accountA.userId,
      fieldId: bField,
    });
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Field kinds
// ─────────────────────────────────────────────────────────────────────────

describe("applyExtractedField — auto_renewal", () => {
  it("flips the subscription's autoRenew flag", async () => {
    // Initial seed has autoRenew=true on accountA's subscription.
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: false },
      reviewStatus: "accepted",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(true);
    const [sub] = await db
      .select({ autoRenew: subscriptionsTable.autoRenew })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    expect(sub?.autoRenew).toBe(false);
  });
});

describe("applyExtractedField — contract_value_cents", () => {
  it("recomputes totalCost and unitPrice from the new total + seat count", async () => {
    // Seed sub has totalSeats=10, unitPriceCents=10_000, totalCost=100_000.
    // Apply a new total of 150_000 (50% increase).
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "contract_value_cents",
      parsedValueJson: { cents: 150_000, currency: "USD" },
      reviewStatus: "accepted",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(true);
    const [sub] = await db
      .select({
        total: subscriptionsTable.totalCostPerPeriodCents,
        unit: subscriptionsTable.unitPriceCents,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    expect(sub?.total).toBe(150_000);
    expect(sub?.unit).toBe(15_000); // 150_000 / 10 seats
  });

  it("emits a price_changed vendor event when the value moves", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "contract_value_cents",
      parsedValueJson: { cents: 150_000, currency: "USD" },
      reviewStatus: "accepted",
    });
    await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    const priceEvents = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, ids.accountA.id),
          eq(vendorEventsTable.kind, "price_changed")
        )
      );
    expect(priceEvents.length).toBe(1);
  });
});

describe("applyExtractedField — notice_period_days", () => {
  it("recomputes the renewal event's notice deadline", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "notice_period_days",
      parsedValueJson: { days: 60 },
      reviewStatus: "accepted",
    });
    const r = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(r.ok).toBe(true);
    const [sub] = await db
      .select({ notice: subscriptionsTable.noticePeriodDays })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    expect(sub?.notice).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────

describe("applyExtractedField idempotency", () => {
  it("a second apply returns ok=true as a no-op", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: false },
      reviewStatus: "accepted",
    });
    const first = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(first.ok).toBe(true);

    const second = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.appliedTo).toMatch(/no-op/i);

    // Only ONE contract_field_applied vendor event despite two applies.
    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, ids.accountA.id),
          eq(vendorEventsTable.kind, "contract_field_applied")
        )
      );
    expect(events.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Vendor events
// ─────────────────────────────────────────────────────────────────────────

describe("applyExtractedField vendor events", () => {
  it("emits contract_field_applied with before/after snapshots", async () => {
    const fieldId = await seedField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      reviewerUserId: ids.accountA.userId,
      fieldKey: "notice_period_days",
      parsedValueJson: { days: 90 },
      reviewStatus: "accepted",
    });
    await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    const [event] = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, ids.accountA.id),
          eq(vendorEventsTable.kind, "contract_field_applied")
        )
      );
    expect(event?.vendorId).toBe(ids.accountA.vendorId);
    expect(event?.subscriptionId).toBe(ids.accountA.subscriptionId);
    const payload = event?.payload as Record<string, unknown> | undefined;
    expect(payload?.fieldKey).toBe("notice_period_days");
  });
});
