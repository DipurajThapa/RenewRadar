/**
 * Shared brief validator — the honesty enforcer. Applied to BOTH the
 * deterministic and the LLM output so neither can smuggle an unsupported claim:
 *   - drops any claim with empty evidence,
 *   - drops any claim whose `quote` is not a verbatim substring of the clause,
 *   - sets meta.engine = "llm" iff any surviving claim is "llm",
 *   - recomputes the headline from the recommendation + top claim.
 */
import type {
  AnswerClaim,
  BriefClaim,
  GroundedAnswer,
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

/**
 * Sibling of `validateBrief` for the Ask assistant — the same honesty gate:
 *   - drops any answer claim with no evidence (no receipts → not emitted),
 *   - drops any claim whose evidence `detail` isn't grounded in a provided fact
 *     (every detail must be a non-empty substring of the source texts — closes
 *     the hole where a quote-less, fabricated narrative detail could survive),
 *   - drops any claim whose `quote` isn't a verbatim substring of a provided
 *     source text (fabricated quote → drop),
 *   - clamps confidence + re-stamps engine = "llm" iff a surviving claim is llm.
 * Applied to BOTH the deterministic and the LLM answer.
 */
export function validateAnswer(
  answer: GroundedAnswer,
  opts: { sourceTexts: string[] }
): GroundedAnswer {
  const haystack = opts.sourceTexts.join("\n");
  const kept: AnswerClaim[] = [];
  for (const claim of answer.answers) {
    if (!claim.evidence || claim.evidence.length === 0) continue; // no receipts → drop
    let evidenceOk = true;
    for (const ev of claim.evidence) {
      // Detail grounding: every evidence item must map to a provided fact. An
      // empty or fabricated detail (not present in any source text) is dropped —
      // even when there is no quote to check.
      if (!ev.detail || !haystack.includes(ev.detail)) {
        evidenceOk = false;
        break;
      }
      if (ev.quote != null && !haystack.includes(ev.quote)) {
        evidenceOk = false; // fabricated quote → drop the whole claim
        break;
      }
    }
    if (!evidenceOk) continue;
    kept.push({
      ...claim,
      confidencePct: clampInt(claim.confidencePct, 0, 100),
    });
  }

  const engine = kept.some((c) => c.engine === "llm") ? "llm" : "deterministic";
  return {
    ...answer,
    answers: kept,
    meta: { ...answer.meta, engine },
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
