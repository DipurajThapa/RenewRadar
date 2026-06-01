/**
 * AI feedback loop (Gate 4) — turns human review decisions into labeled data.
 *
 * The compounding-moat insight: every time a human accepts, edits, rejects, or
 * UNDOES an AI-extracted field, they are labeling the AI's output. Those labels
 * already live in `ai_extracted_field` — this module reads them (no new table,
 * no parallel store) into two products:
 *
 *   1. getExtractionCorrections — the AI got it wrong: rejected fields and
 *      human-edited fields (AI value vs the corrected value). This is the
 *      golden-set feed for prompt/threshold tuning.
 *   2. getConfidenceCalibration — is the AI's self-reported confidence honest?
 *      Per confidence bucket, how often did a human actually accept the value?
 *      A high-confidence bucket with a low accept rate is the measurable form of
 *      the "overconfident when wrong" finding from the Gate-3 eval.
 *
 * Terminal field states (after the review action runs):
 *   accepted as-is → reviewStatus "applied", reviewer set, no edited value
 *   human-edited   → reviewStatus "applied", reviewer set, edited value present
 *   rejected/undo  → reviewStatus "rejected", reviewer set
 *   AI auto-applied→ reviewStatus "applied", NO reviewer (excluded — not a human label)
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { aiExtractedFieldsTable } from "@server/infrastructure/db/schema";
import type { AiFieldKey } from "@server/infrastructure/db/schema";

export type ExtractionCorrection = {
  fieldId: string;
  documentId: string;
  fieldKey: AiFieldKey;
  /** "edited" = human changed the value; "rejected" = human discarded/undid it. */
  decision: "edited" | "rejected";
  confidencePct: number;
  evidenceQuote: string;
  /** What the AI proposed. */
  aiValueJson: unknown;
  /** The human's corrected value (edited) or null (rejected). */
  humanValueJson: unknown | null;
};

/**
 * Labeled corrections — the cases the AI got wrong. Newest data first is not
 * important here (callers aggregate), so we keep it simple.
 */
export async function getExtractionCorrections(
  accountId: string
): Promise<ExtractionCorrection[]> {
  const rows = await db
    .select()
    .from(aiExtractedFieldsTable)
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        isNotNull(aiExtractedFieldsTable.reviewedByUserId)
      )
    );

  const out: ExtractionCorrection[] = [];
  for (const r of rows) {
    const editedAndApplied =
      r.reviewStatus === "applied" && r.reviewerEditedValueJson != null;
    const rejected = r.reviewStatus === "rejected";
    if (!editedAndApplied && !rejected) continue;
    out.push({
      fieldId: r.id,
      documentId: r.documentId,
      fieldKey: r.fieldKey,
      decision: rejected ? "rejected" : "edited",
      confidencePct: r.confidence,
      evidenceQuote: r.evidenceQuote,
      aiValueJson: r.parsedValueJson,
      humanValueJson: rejected ? null : r.reviewerEditedValueJson,
    });
  }
  return out;
}

export type CalibrationBucket = {
  bucket: string;
  /** Human accepted the AI value as-is. */
  accepted: number;
  /** Human kept the field but changed the value. */
  edited: number;
  /** Human discarded or undid the value. */
  rejected: number;
  /** accepted + edited + rejected (human-decided fields in this bucket). */
  decided: number;
  /** accepted / decided, or null when nothing decided yet. */
  acceptRatePct: number | null;
};

const BUCKETS: Array<{ bucket: string; lo: number; hi: number }> = [
  { bucket: "0-69", lo: 0, hi: 69 },
  { bucket: "70-89", lo: 70, hi: 89 },
  { bucket: "90-100", lo: 90, hi: 100 },
];

/**
 * Confidence calibration from real human decisions. For each confidence bucket,
 * the accept rate tells you whether the AI's confidence is earned. Excludes
 * AI auto-applied fields with no human reviewer (those aren't a human label).
 */
export async function getConfidenceCalibration(
  accountId: string
): Promise<CalibrationBucket[]> {
  const rows = await db
    .select({
      confidence: aiExtractedFieldsTable.confidence,
      reviewStatus: aiExtractedFieldsTable.reviewStatus,
      reviewedByUserId: aiExtractedFieldsTable.reviewedByUserId,
      editedValue: aiExtractedFieldsTable.reviewerEditedValueJson,
    })
    .from(aiExtractedFieldsTable)
    .where(
      and(
        eq(aiExtractedFieldsTable.accountId, accountId),
        isNotNull(aiExtractedFieldsTable.reviewedByUserId)
      )
    );

  return BUCKETS.map((d) => {
    let accepted = 0;
    let edited = 0;
    let rejected = 0;
    for (const r of rows) {
      if (r.confidence < d.lo || r.confidence > d.hi) continue;
      if (r.reviewStatus === "rejected") {
        rejected++;
      } else if (r.reviewStatus === "applied") {
        if (r.editedValue != null) edited++;
        else accepted++;
      }
    }
    const decided = accepted + edited + rejected;
    return {
      bucket: d.bucket,
      accepted,
      edited,
      rejected,
      decided,
      acceptRatePct: decided === 0 ? null : Math.round((accepted / decided) * 100),
    };
  });
}
