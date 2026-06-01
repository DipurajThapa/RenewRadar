/**
 * Confidence-gated AI auto-apply + one-click undo (Gate 2b).
 *
 * The conservative policy: only PENDING fields that are in the safe set
 * (renewal/expiry date, notice period, auto-renew), at/above the confidence
 * floor, and linked to a subscription get written without human review — and
 * every such write is reversible. These tests pin that gate and the undo, plus
 * tenant isolation.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import type { AiFieldKey } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  applyExtractedField,
  autoApplyHighConfidenceFields,
  revertAutoAppliedField,
} from "@server/application/documents/apply-field";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

async function seedPendingField(args: {
  accountId: string;
  subscriptionId: string | null;
  uploaderUserId: string;
  fieldKey: AiFieldKey;
  parsedValueJson: Record<string, unknown>;
  confidence: number;
}): Promise<{ fieldId: string; documentId: string }> {
  const [doc] = await db
    .insert(documentsTable)
    .values({
      accountId: args.accountId,
      uploadedByUserId: args.uploaderUserId,
      kind: "contract" as const,
      filename: `${args.fieldKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1000,
      storageKey: `test/${args.fieldKey}-${Date.now()}-${Math.random()}.pdf`,
      checksumSha256: `sha-${args.fieldKey}-${Date.now()}-${Math.random()}`,
      textExtractionStatus: "ready" as const,
      subscriptionId: args.subscriptionId,
    })
    .returning();
  if (!doc) throw new Error("seed doc failed");

  const [run] = await db
    .insert(aiExtractionRunsTable)
    .values({
      accountId: args.accountId,
      documentId: doc.id,
      provider: "test",
      model: "test",
      promptVersion: "v1",
      status: "succeeded",
      pagesCharged: 1,
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
      confidence: args.confidence,
      evidenceQuote: "evidence",
      evidencePageNumber: 1,
      reviewStatus: "pending" as const,
      reviewedByUserId: null,
    })
    .returning();
  if (!field) throw new Error("seed field failed");
  return { fieldId: field.id, documentId: doc.id };
}

function getSub(id: string) {
  return db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.id, id))
    .limit(1)
    .then((r) => r[0]!);
}

function getField(id: string) {
  return db
    .select()
    .from(aiExtractedFieldsTable)
    .where(eq(aiExtractedFieldsTable.id, id))
    .limit(1)
    .then((r) => r[0]!);
}

describe("autoApplyHighConfidenceFields — conservative gate", () => {
  it("auto-applies a safe, high-confidence field (no human reviewer)", async () => {
    const { fieldId, documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "notice_period_days",
      parsedValueJson: { days: 73 },
      confidence: 95,
    });

    const res = await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect(res.autoApplied).toBe(1);

    const sub = await getSub(ids.accountA.subscriptionId);
    expect(sub.noticePeriodDays).toBe(73);

    const field = await getField(fieldId);
    expect(field.reviewStatus).toBe("applied");
    expect(field.appliedAt).not.toBeNull();
    // The discriminator: AI-applied has NO human reviewer.
    expect(field.reviewedByUserId).toBeNull();
  });

  it("does NOT auto-apply a below-threshold field", async () => {
    const { fieldId, documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "notice_period_days",
      parsedValueJson: { days: 73 },
      confidence: 80, // below 90 floor
    });
    const res = await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect(res.autoApplied).toBe(0);
    expect((await getField(fieldId)).reviewStatus).toBe("pending");
  });

  it("does NOT auto-apply an unsafe field even at high confidence", async () => {
    const { fieldId, documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "contract_value_cents", // not in safe set
      parsedValueJson: { cents: 999_999, currency: "USD" },
      confidence: 99,
    });
    const res = await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect(res.autoApplied).toBe(0);
    expect((await getField(fieldId)).reviewStatus).toBe("pending");
  });

  it("does NOT auto-apply a field with no subscription linked", async () => {
    const { documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: null,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: true },
      confidence: 98,
    });
    const res = await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect(res.autoApplied).toBe(0);
  });
});

describe("revertAutoAppliedField — one-click undo", () => {
  it("restores the prior value and flips the field to rejected", async () => {
    const before = await getSub(ids.accountA.subscriptionId);
    const original = before.noticePeriodDays;

    const { fieldId, documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "notice_period_days",
      parsedValueJson: { days: original + 17 },
      confidence: 95,
    });
    await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect((await getSub(ids.accountA.subscriptionId)).noticePeriodDays).toBe(
      original + 17
    );

    const rev = await revertAutoAppliedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(rev.ok).toBe(true);

    // Subscription restored to its pre-auto-apply value.
    expect((await getSub(ids.accountA.subscriptionId)).noticePeriodDays).toBe(
      original
    );
    // Field becomes a labeled correction: rejected, appliedAt cleared, reviewer set.
    const field = await getField(fieldId);
    expect(field.reviewStatus).toBe("rejected");
    expect(field.appliedAt).toBeNull();
    expect(field.reviewedByUserId).toBe(ids.accountA.userId);
  });

  it("refuses to revert a HUMAN-applied field", async () => {
    // Seed an accepted+reviewed field and apply it via the human path.
    const { fieldId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: false },
      confidence: 95,
    });
    await db
      .update(aiExtractedFieldsTable)
      .set({
        reviewStatus: "accepted",
        reviewedByUserId: ids.accountA.userId,
        reviewedAt: new Date(),
      })
      .where(eq(aiExtractedFieldsTable.id, fieldId));
    const applied = await applyExtractedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(applied.ok).toBe(true);

    const rev = await revertAutoAppliedField({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      fieldId,
    });
    expect(rev.ok).toBe(false);
  });
});

describe("auto-apply + revert tenant isolation", () => {
  it("auto-apply is scoped to the account; another tenant can't touch it", async () => {
    const { fieldId, documentId } = await seedPendingField({
      accountId: ids.accountA.id,
      subscriptionId: ids.accountA.subscriptionId,
      uploaderUserId: ids.accountA.userId,
      fieldKey: "auto_renewal",
      parsedValueJson: { yes: false },
      confidence: 97,
    });

    // Account B tries to auto-apply against A's document id → nothing eligible.
    const wrong = await autoApplyHighConfidenceFields({
      accountId: ids.accountB.id,
      documentId,
    });
    expect(wrong.autoApplied).toBe(0);
    expect((await getField(fieldId)).reviewStatus).toBe("pending");

    // Correct tenant applies it.
    await autoApplyHighConfidenceFields({
      accountId: ids.accountA.id,
      documentId,
    });
    expect((await getField(fieldId)).reviewStatus).toBe("applied");

    // Account B cannot revert A's field.
    const rev = await revertAutoAppliedField({
      accountId: ids.accountB.id,
      actorUserId: ids.accountB.userId,
      fieldId,
    });
    expect(rev.ok).toBe(false);
    // Still applied for the real owner.
    expect((await getField(fieldId)).reviewStatus).toBe("applied");
  });
});
