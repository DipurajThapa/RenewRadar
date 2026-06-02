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
  BriefEvidence,
  GroundedAnswer,
  RenewalBriefInput,
  RenewalIntelligenceBrief,
} from "./types";

const ACTION_HEADLINE: Record<string, string> = {
  renewed: "Renew as-is",
  renewed_with_adjustments: "Renew — but renegotiate first",
  downgraded: "Downgrade at renewal",
  cancelled: "Cancel before the notice deadline",
  deferred: "Decide now — clock is running",
};

/**
 * Which evidence sources actually have backing data in this brief's input.
 * An LLM may only cite a source it was actually given — citing `benchmark`
 * when no benchmark was provided is the canonical fabrication.
 */
function presentSources(
  input: RenewalBriefInput
): Set<BriefEvidence["source"]> {
  // These two are always derivable from the subscription itself.
  const s = new Set<BriefEvidence["source"]>([
    "notice_deadline",
    "auto_renew_flag",
  ]);
  if (input.chargeHistory.length > 0) s.add("charge_history");
  if (input.benchmark != null) s.add("benchmark");
  if (input.priceIncreaseClauseText && input.priceIncreaseClauseText.length > 0)
    s.add("price_increase_clause");
  if (input.priorDecisions.length > 0) s.add("prior_decision");
  return s;
}

/**
 * Every numeric magnitude the input actually supports, in BOTH cents and
 * whole-dollar form (the model sees cents in the payload but tends to write
 * dollars). Used to reject fabricated figures in LLM prose — the product's
 * "numbers stay deterministic; the model never invents a dollar figure" rule,
 * enforced rather than trusted.
 */
function groundedNumbers(input: RenewalBriefInput): Set<string> {
  const nums = new Set<string>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    const abs = Math.abs(n);
    nums.add(String(Math.round(abs)));
    nums.add(String(Math.round(abs / 100))); // cents → dollars
  };
  add(input.annualValueCents);
  for (const c of input.chargeHistory) add(c.totalAnnualizedCents);
  const b = input.benchmark;
  if (b) {
    add(b.sampleAccounts);
    add(b.typicalNoticePeriodDays);
    add(b.autoRenewRatePct);
    add(b.medianAnnualValueCents);
    add(b.medianSavingsAnnualCents);
    for (const lever of b.topLevers) add(lever.count);
  }
  for (const p of input.priorDecisions) add(p.savedAnnualUsdCents);
  return nums;
}

/**
 * True if `text` contains a "large" number (> 31, so dollar figures / big
 * counts / big percentages — not day-of-month-sized ordinals) that is NOT in
 * the grounded set. Small integers are allowed through as low-risk ordinals.
 */
function hasUngroundedNumber(text: string, grounded: Set<string>): boolean {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g);
  if (!matches) return false;
  for (const raw of matches) {
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const whole = Math.round(Math.abs(value));
    if (whole <= 31) continue; // ordinals / counts / small percentages
    if (!grounded.has(String(whole))) return true;
  }
  return false;
}

export function validateBrief(
  brief: RenewalIntelligenceBrief,
  opts: { clauseText: string | null; input?: RenewalBriefInput | null }
): RenewalIntelligenceBrief {
  // When the input signals are available we can hold LLM claims to true
  // grounding: a cited source must exist, and any dollar-scale number in the
  // claim must trace to a provided figure. Deterministic claims are built from
  // the same data by our own code, so they're trusted and skip these gates.
  const allowedSources = opts.input ? presentSources(opts.input) : null;
  const grounded = opts.input ? groundedNumbers(opts.input) : null;

  const kept: BriefClaim[] = [];
  for (const claim of brief.claims) {
    if (!claim.evidence || claim.evidence.length === 0) continue; // no receipts → drop
    const isLlm = claim.engine === "llm";
    let evidenceOk = true;
    for (const ev of claim.evidence) {
      if (ev.quote != null) {
        const clause = opts.clauseText ?? "";
        if (!clause.includes(ev.quote)) {
          evidenceOk = false; // fabricated quote → drop the whole claim
          break;
        }
      }
      // Grounding gates apply only to model-authored claims, and only when we
      // have the input to check against.
      if (isLlm && allowedSources && grounded) {
        if (!allowedSources.has(ev.source)) {
          evidenceOk = false; // cites a signal that wasn't provided → drop
          break;
        }
        if (!ev.detail || ev.detail.trim().length === 0) {
          evidenceOk = false; // empty receipt → drop
          break;
        }
        if (
          hasUngroundedNumber(ev.detail, grounded) ||
          hasUngroundedNumber(claim.statement, grounded)
        ) {
          evidenceOk = false; // invented a dollar figure / magnitude → drop
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
