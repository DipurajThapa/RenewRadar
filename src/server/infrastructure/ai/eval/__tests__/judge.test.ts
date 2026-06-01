/**
 * Reasoning eval — rule checks, judge-verdict parsing, aggregation (pure).
 */
import { describe, expect, it } from "vitest";
import {
  aggregateReasoning,
  parseJudgeVerdict,
  ruleCheck,
  type ReasoningEvalItem,
} from "../judge";
import type {
  RenewalBriefInput,
  RenewalIntelligenceBrief,
} from "../../reasoning/types";

function input(over: Partial<RenewalBriefInput> = {}): RenewalBriefInput {
  return {
    accountId: "a",
    subscriptionId: "s",
    vendorName: "Acme",
    productName: "Pro",
    billingCycle: "annual",
    annualValueCents: 90_000,
    autoRenew: true,
    noticePeriodDays: 30,
    termEndDate: "2026-12-31",
    daysUntilNoticeDeadline: 10,
    noticeDeadlineMissed: false,
    hasPriceIncreaseClause: false,
    priceIncreaseClauseText: null,
    chargeHistory: [],
    benchmark: null,
    priorDecisions: [],
    ...over,
  };
}

function brief(over: Partial<RenewalIntelligenceBrief> = {}): RenewalIntelligenceBrief {
  return {
    meta: {
      provider: "ollama-reasoner",
      model: "qwen",
      promptVersion: "v1",
      confidencePct: 80,
      engine: "llm",
      briefVersion: "brief-v1",
    },
    headline: "h",
    recommendedAction: "renewed_with_adjustments",
    claims: [
      {
        key: "renewal_risk",
        statement: "s",
        engine: "llm",
        confidencePct: 80,
        evidence: [{ source: "notice_deadline", detail: "10 days", quote: null, refId: null }],
      },
    ],
    predictedNextAnnualCents: null,
    ...over,
  };
}

describe("ruleCheck", () => {
  it("accepts an action in the defensible set", () => {
    const r = ruleCheck(input(), brief(), ["renewed_with_adjustments", "renewed"]);
    expect(r.actionAcceptable).toBe(true);
    expect(r.groundingOk).toBe(true);
    expect(r.hallucinationEscapes).toBe(0);
    expect(r.engineLlm).toBe(true);
  });

  it("enforces missed-deadline → deferred", () => {
    const missedBad = ruleCheck(
      input({ noticeDeadlineMissed: true }),
      brief({ recommendedAction: "renewed" }),
      ["renewed", "deferred"]
    );
    expect(missedBad.missedDeadlineOk).toBe(false);

    const missedOk = ruleCheck(
      input({ noticeDeadlineMissed: true }),
      brief({ recommendedAction: "deferred" }),
      ["deferred"]
    );
    expect(missedOk.missedDeadlineOk).toBe(true);
  });

  it("flags an empty-evidence claim as ungrounded", () => {
    const r = ruleCheck(
      input(),
      brief({
        claims: [
          { key: "leverage", statement: "x", engine: "llm", confidencePct: 70, evidence: [] },
        ],
      }),
      ["renewed_with_adjustments"]
    );
    expect(r.groundingOk).toBe(false);
  });

  it("counts a fabricated clause quote as a hallucination escape", () => {
    const r = ruleCheck(
      input({ priceIncreaseClauseText: "real clause text" }),
      brief({
        claims: [
          {
            key: "leverage",
            statement: "x",
            engine: "llm",
            confidencePct: 70,
            evidence: [{ source: "price_increase_clause", detail: "d", quote: "NOT IN CLAUSE", refId: null }],
          },
        ],
      }),
      ["renewed_with_adjustments"]
    );
    expect(r.hallucinationEscapes).toBe(1);
  });
});

describe("parseJudgeVerdict", () => {
  it("passes when both axes clear 70", () => {
    expect(parseJudgeVerdict({ grounded: 85, reasonable: 75 }).pass).toBe(true);
  });
  it("fails when an axis is below 70", () => {
    expect(parseJudgeVerdict({ grounded: 60, reasonable: 95 }).pass).toBe(false);
  });
  it("defaults missing fields to 0 (fail) and clamps", () => {
    expect(parseJudgeVerdict({}).pass).toBe(false);
    expect(parseJudgeVerdict({ grounded: 250, reasonable: 80 }).grounded).toBe(100);
  });
});

describe("aggregateReasoning", () => {
  it("computes rate metrics", () => {
    const items: ReasoningEvalItem[] = [
      {
        rule: { actionAcceptable: true, missedDeadlineOk: true, groundingOk: true, hallucinationEscapes: 0, engineLlm: true },
        judge: { grounded: 90, reasonable: 90, pass: true, reason: "" },
      },
      {
        rule: { actionAcceptable: false, missedDeadlineOk: true, groundingOk: true, hallucinationEscapes: 1, engineLlm: true },
        judge: { grounded: 50, reasonable: 90, pass: false, reason: "" },
      },
    ];
    const r = aggregateReasoning(items);
    expect(r.ruleAccuracyPct).toBe(50);
    expect(r.groundingRatePct).toBe(100);
    expect(r.hallucinationEscapes).toBe(1);
    expect(r.judgePassRatePct).toBe(50);
    expect(r.avgGrounded).toBe(70);
  });
});
