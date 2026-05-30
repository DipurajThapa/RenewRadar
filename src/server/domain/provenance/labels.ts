/**
 * Derived provenance labels — VERIFIED / INFERRED / UNCERTAIN.
 *
 * The directive's no-hallucination bar requires every AI-surfaced value to
 * carry not just a confidence number but an honest, human-readable trust band.
 * This is a PURE DERIVATION over data that already exists (`ai_extracted_field`
 * confidence + review status + evidence; `BriefClaim` confidence + evidence) —
 * NOT a new fact store. It is the single source of truth for the band, so the
 * review-queue badge, the per-item action package, and any future surface all
 * agree. The old UI-only `confidenceClass()` thresholds are absorbed here.
 */
import type { BriefClaim } from "@server/infrastructure/ai/reasoning/types";

export type ProvenanceLabel = "verified" | "inferred" | "uncertain";

/** Review states where a human has confirmed the value — trust outranks model confidence. */
const HUMAN_CONFIRMED: ReadonlySet<string> = new Set([
  "accepted",
  "edited",
  "applied",
]);

/**
 * The band for a single extracted field.
 *
 *   - human-confirmed (accepted/edited/applied) → VERIFIED, regardless of pct
 *   - no evidence at all                        → UNCERTAIN (a value with no receipt)
 *   - ≥ 85% with evidence                       → VERIFIED
 *   - 65–84%                                     → INFERRED
 *   - < 65%                                      → UNCERTAIN
 */
export function fieldProvenance(
  confidencePct: number,
  reviewStatus: string,
  hasEvidence: boolean
): ProvenanceLabel {
  if (HUMAN_CONFIRMED.has(reviewStatus)) return "verified";
  if (!hasEvidence) return "uncertain";
  if (confidencePct >= 85) return "verified";
  if (confidencePct >= 65) return "inferred";
  return "uncertain";
}

/**
 * The band for a reasoning-brief claim. A claim is machine-derived (never
 * "human confirmed"), so it rides the same confidence + evidence thresholds.
 * An emitted claim is contractually required to carry ≥1 evidence item, but we
 * stay defensive: an evidence-less claim is UNCERTAIN.
 */
export function claimProvenance(claim: BriefClaim): ProvenanceLabel {
  return fieldProvenance(
    claim.confidencePct,
    "pending",
    claim.evidence.length > 0
  );
}

export const PROVENANCE_LABEL_TEXT: Record<ProvenanceLabel, string> = {
  verified: "Verified",
  inferred: "Inferred",
  uncertain: "Uncertain",
};
