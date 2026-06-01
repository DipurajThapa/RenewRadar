/**
 * Reasoning eval (Phase 1, C3) — measure brief quality without grading ourselves.
 *
 * Two independent checks per brief:
 *   1. Deterministic RULE checks (no model): recommendation ∈ defensible set,
 *      missed-deadline ⇒ deferred, every claim evidence-bound, 0 fabricated quotes.
 *   2. An INDEPENDENT JUDGE — a DIFFERENT model than the one that wrote the brief
 *      — scores grounding + reasonableness 0–100. Using a different model avoids
 *      a model rubber-stamping its own output (teaching-to-the-test).
 *
 * Pure here (prompt builder, verdict parser, rule checks, aggregation); the judge
 * model call lives in the orchestrator, so this file is unit-tested offline.
 */
import type {
  RecommendedAction,
  RenewalBriefInput,
  RenewalIntelligenceBrief,
} from "../reasoning/types";

function num(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type ReasoningRuleResult = {
  actionAcceptable: boolean;
  /** If the deadline is missed, the only honest call is "deferred". */
  missedDeadlineOk: boolean;
  /** Every emitted claim has ≥1 evidence item. */
  groundingOk: boolean;
  /** Claims whose quote isn't a verbatim substring of the clause (must be 0). */
  hallucinationEscapes: number;
  engineLlm: boolean;
};

export function ruleCheck(
  input: RenewalBriefInput,
  brief: RenewalIntelligenceBrief,
  acceptableActions: RecommendedAction[]
): ReasoningRuleResult {
  const clause = input.priceIncreaseClauseText ?? "";
  let hallucinationEscapes = 0;
  let groundingOk = brief.claims.length > 0;
  for (const c of brief.claims) {
    if (!c.evidence || c.evidence.length === 0) groundingOk = false;
    for (const ev of c.evidence) {
      if (ev.quote != null && !clause.includes(ev.quote)) hallucinationEscapes++;
    }
  }
  return {
    actionAcceptable: acceptableActions.includes(brief.recommendedAction),
    missedDeadlineOk:
      !input.noticeDeadlineMissed || brief.recommendedAction === "deferred",
    groundingOk,
    hallucinationEscapes,
    engineLlm: brief.meta.engine === "llm",
  };
}

export const JUDGE_SYSTEM_PROMPT = `You are an impartial reviewer of a SaaS renewal
brief that was produced by a DIFFERENT AI. Score it on two axes and return ONLY
this JSON object, no prose:
{ "grounded": <integer 0-100>, "reasonable": <integer 0-100>, "reason": "<one sentence>" }
- grounded: are ALL the brief's claims supported by the provided signals? A claim
  that asserts a number, date, or fact not present in the signals scores LOW.
- reasonable: is the recommendedAction defensible given the signals? A
  recommendation that ignores an obvious signal (a missed notice deadline, a large
  price increase, a clear benchmark gap) scores LOW.
Be strict and skeptical. Do not reward fluent writing — reward accuracy.`;

export function buildJudgeUser(
  input: RenewalBriefInput,
  brief: RenewalIntelligenceBrief
): string {
  return JSON.stringify({
    signals: {
      vendor: input.vendorName,
      annualValueCents: input.annualValueCents,
      autoRenew: input.autoRenew,
      daysUntilNoticeDeadline: input.daysUntilNoticeDeadline,
      noticeDeadlineMissed: input.noticeDeadlineMissed,
      hasPriceIncreaseClause: input.hasPriceIncreaseClause,
      chargeHistory: input.chargeHistory,
      benchmark: input.benchmark,
      priorDecisions: input.priorDecisions,
    },
    brief: {
      recommendedAction: brief.recommendedAction,
      claims: brief.claims.map((c) => ({
        key: c.key,
        statement: c.statement,
        evidence: c.evidence.map((e) => e.detail),
      })),
    },
  });
}

export type JudgeVerdict = {
  grounded: number;
  reasonable: number;
  pass: boolean;
  reason: string;
};

/** A judge verdict passes when BOTH axes clear 70. */
export function parseJudgeVerdict(raw: unknown): JudgeVerdict {
  const o = (raw ?? {}) as Record<string, unknown>;
  const grounded = clamp(num(o.grounded, 0));
  const reasonable = clamp(num(o.reasonable, 0));
  return {
    grounded,
    reasonable,
    pass: grounded >= 70 && reasonable >= 70,
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

export type ReasoningEvalItem = {
  rule: ReasoningRuleResult;
  judge: JudgeVerdict;
};

export type ReasoningEvalReport = {
  scenarios: number;
  ruleAccuracyPct: number;
  missedDeadlineOkPct: number;
  groundingRatePct: number;
  hallucinationEscapes: number;
  engineLlmPct: number;
  judgePassRatePct: number;
  avgGrounded: number;
  avgReasonable: number;
};

export function aggregateReasoning(items: ReasoningEvalItem[]): ReasoningEvalReport {
  const n = items.length || 1;
  const pctOf = (p: (i: ReasoningEvalItem) => boolean) =>
    Math.round((items.filter(p).length / n) * 100);
  const avg = (f: (i: ReasoningEvalItem) => number) =>
    Math.round(items.reduce((s, i) => s + f(i), 0) / n);
  return {
    scenarios: items.length,
    ruleAccuracyPct: pctOf((i) => i.rule.actionAcceptable),
    missedDeadlineOkPct: pctOf((i) => i.rule.missedDeadlineOk),
    groundingRatePct: pctOf((i) => i.rule.groundingOk),
    hallucinationEscapes: items.reduce((s, i) => s + i.rule.hallucinationEscapes, 0),
    engineLlmPct: pctOf((i) => i.rule.engineLlm),
    judgePassRatePct: pctOf((i) => i.judge.pass),
    avgGrounded: avg((i) => i.judge.grounded),
    avgReasonable: avg((i) => i.judge.reasonable),
  };
}
