/**
 * AI feedback loop (Gate 4) — derives labeled corrections + confidence
 * calibration from human review decisions already stored on ai_extracted_field.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
} from "@server/infrastructure/db/schema";
import type { AiFieldKey } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  getCalibrationModel,
  getCalibrationPoints,
  getConfidenceCalibration,
  getExtractionCorrections,
} from "@server/application/ai-feedback";
import { applyCalibration } from "@server/infrastructure/ai/eval/calibration";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

type Terminal = "accepted" | "edited" | "rejected" | "ai_auto";

async function seedDecided(args: {
  accountId: string;
  reviewerUserId: string;
  fieldKey: AiFieldKey;
  confidence: number;
  terminal: Terminal;
}): Promise<void> {
  const [doc] = await db
    .insert(documentsTable)
    .values({
      accountId: args.accountId,
      uploadedByUserId: args.reviewerUserId,
      kind: "contract" as const,
      filename: "c.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      storageKey: `k-${Date.now()}-${Math.random()}`,
      checksumSha256: `s-${Date.now()}-${Math.random()}`,
      textExtractionStatus: "ready" as const,
    })
    .returning();
  const [run] = await db
    .insert(aiExtractionRunsTable)
    .values({
      accountId: args.accountId,
      documentId: doc!.id,
      provider: "test",
      model: "test",
      promptVersion: "v1",
      status: "succeeded",
      pagesCharged: 1,
      startedAt: new Date(),
    })
    .returning();

  // Map a logical terminal state onto the real column shape.
  const base = {
    accountId: args.accountId,
    runId: run!.id,
    documentId: doc!.id,
    fieldKey: args.fieldKey,
    rawValue: "raw",
    parsedValueJson: { days: 30 },
    confidence: args.confidence,
    evidenceQuote: "q",
    evidencePageNumber: 1,
  };
  if (args.terminal === "accepted") {
    await db.insert(aiExtractedFieldsTable).values({
      ...base,
      reviewStatus: "applied",
      reviewedByUserId: args.reviewerUserId,
      reviewedAt: new Date(),
      appliedAt: new Date(),
    });
  } else if (args.terminal === "edited") {
    await db.insert(aiExtractedFieldsTable).values({
      ...base,
      reviewStatus: "applied",
      reviewedByUserId: args.reviewerUserId,
      reviewedAt: new Date(),
      appliedAt: new Date(),
      reviewerEditedValueJson: { days: 45 },
    });
  } else if (args.terminal === "rejected") {
    await db.insert(aiExtractedFieldsTable).values({
      ...base,
      reviewStatus: "rejected",
      reviewedByUserId: args.reviewerUserId,
      reviewedAt: new Date(),
    });
  } else {
    // AI auto-applied — applied with NO human reviewer (must be excluded).
    await db.insert(aiExtractedFieldsTable).values({
      ...base,
      reviewStatus: "applied",
      reviewedByUserId: null,
      appliedAt: new Date(),
    });
  }
}

describe("getExtractionCorrections", () => {
  it("returns edited + rejected fields, excludes accepted + AI auto-applied", async () => {
    const a = ids.accountA;
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 95, terminal: "accepted" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 92, terminal: "edited" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "auto_renewal", confidence: 88, terminal: "rejected" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "renewal_date", confidence: 99, terminal: "ai_auto" });

    const corrections = await getExtractionCorrections(a.id);
    expect(corrections).toHaveLength(2);
    const edited = corrections.find((c) => c.decision === "edited");
    expect(edited?.humanValueJson).toEqual({ days: 45 });
    const rejected = corrections.find((c) => c.decision === "rejected");
    expect(rejected?.humanValueJson).toBeNull();
  });

  it("is tenant-scoped", async () => {
    await seedDecided({ accountId: ids.accountA.id, reviewerUserId: ids.accountA.userId, fieldKey: "notice_period_days", confidence: 90, terminal: "rejected" });
    const forB = await getExtractionCorrections(ids.accountB.id);
    expect(forB).toHaveLength(0);
  });
});

describe("getConfidenceCalibration", () => {
  it("computes accept rate per confidence bucket from human decisions", async () => {
    const a = ids.accountA;
    // 90-100 bucket: 1 accepted, 1 edited, 1 rejected → acceptRate 33%.
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 95, terminal: "accepted" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 92, terminal: "edited" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "auto_renewal", confidence: 91, terminal: "rejected" });
    // 70-89 bucket: 1 accepted → 100%.
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "renewal_date", confidence: 80, terminal: "accepted" });
    // AI auto-applied at high confidence must NOT count as a human signal.
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "renewal_date", confidence: 99, terminal: "ai_auto" });

    const cal = await getConfidenceCalibration(a.id);
    const high = cal.find((b) => b.bucket === "90-100")!;
    expect(high.accepted).toBe(1);
    expect(high.edited).toBe(1);
    expect(high.rejected).toBe(1);
    expect(high.decided).toBe(3);
    expect(high.acceptRatePct).toBe(33);

    const mid = cal.find((b) => b.bucket === "70-89")!;
    expect(mid.decided).toBe(1);
    expect(mid.acceptRatePct).toBe(100);

    const low = cal.find((b) => b.bucket === "0-69")!;
    expect(low.decided).toBe(0);
    expect(low.acceptRatePct).toBeNull();
  });
});

describe("getCalibrationModel (D1 — the moat loop closing)", () => {
  it("derives a per-account calibration map from review decisions", async () => {
    const a = ids.accountA;
    // At confidence 95: 2 accepted (correct) + 2 rejected (wrong) → 50% accuracy.
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 95, terminal: "accepted" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "notice_period_days", confidence: 95, terminal: "accepted" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "auto_renewal", confidence: 95, terminal: "rejected" });
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "auto_renewal", confidence: 95, terminal: "rejected" });
    // AI auto-applied (no reviewer) must be excluded.
    await seedDecided({ accountId: a.id, reviewerUserId: a.userId, fieldKey: "renewal_date", confidence: 95, terminal: "ai_auto" });

    const points = await getCalibrationPoints(a.id);
    expect(points).toHaveLength(4);

    const map = await getCalibrationModel(a.id);
    // raw 95% confidence → calibrated to the observed 50% accuracy.
    expect(applyCalibration(map, 95)).toBe(50);
  });

  it("is tenant-scoped", async () => {
    await seedDecided({ accountId: ids.accountA.id, reviewerUserId: ids.accountA.userId, fieldKey: "notice_period_days", confidence: 90, terminal: "rejected" });
    expect(await getCalibrationPoints(ids.accountB.id)).toHaveLength(0);
  });
});
