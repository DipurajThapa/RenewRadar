/**
 * Shared brief validator — the honesty enforcer. Applied to BOTH the
 * deterministic and the LLM output so neither can smuggle an unsupported claim:
 *   - drops any claim with empty evidence,
 *   - drops any claim whose `quote` is not a verbatim substring of the clause,
 *   - sets meta.engine = "llm" iff any surviving claim is "llm",
 *   - recomputes the headline from the recommendation + top claim.
 */
import type {
  BriefClaim,
  RenewalIntelligenceBrief,
} from "./types";

const ACTION_HEADLINE: Record<string, string> = {
  renewed: "Renew as-is",
  renewed_with_adjustments: "Renew — but renegotiate first",
  downgraded: "Downgrade at renewal",
  cancelled: "Cancel before the notice deadline",
  deferred: "Decide now — clock is running",
};

export function validateBrief(
  brief: RenewalIntelligenceBrief,
  opts: { clauseText: string | null }
): RenewalIntelligenceBrief {
  const kept: BriefClaim[] = [];
  for (const claim of brief.claims) {
    if (!claim.evidence || claim.evidence.length === 0) continue; // no receipts → drop
    let evidenceOk = true;
    for (const ev of claim.evidence) {
      if (ev.quote != null) {
        const clause = opts.clauseText ?? "";
        if (!clause.includes(ev.quote)) {
          evidenceOk = false; // fabricated quote → drop the whole claim
          break;
        }
      }
    }
    if (!evidenceOk) continue;
    kept.push({
      ...claim,
      confidencePct: clampInt(claim.confidencePct, 0, 100),
    });
  }

  const engine = kept.some((c) => c.engine === "llm") ? "llm" : "deterministic";
  const top = [...kept].sort((a, b) => b.confidencePct - a.confidencePct)[0];
  const headline =
    `${ACTION_HEADLINE[brief.recommendedAction] ?? "Review this renewal"}` +
    (top ? ` — ${top.statement}` : "");

  return {
    ...brief,
    claims: kept,
    meta: { ...brief.meta, engine },
    headline: headline.slice(0, 140),
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
