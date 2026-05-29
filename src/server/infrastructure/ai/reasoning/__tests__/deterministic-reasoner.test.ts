/**
 * Pure tests for the deterministic Renewal Intelligence engine + the factory
 * provenance contract. No DB. Asserts: genuine multi-signal composition,
 * deterministic output, evidence-bound claims, honest provenance, and the
 * cross-signal confidence penalty.
 */
import { describe, expect, it, afterEach } from "vitest";
import { DeterministicReasoningProvider } from "@server/infrastructure/ai/reasoning/deterministic-provider";
import { validateBrief } from "@server/infrastructure/ai/reasoning/validate";
import {
  getReasoningProvider,
  _resetReasoningProviderForTests,
} from "@server/infrastructure/ai";
import type {
  RenewalBriefInput,
  RenewalIntelligenceBrief,
} from "@server/infrastructure/ai/reasoning/types";

const provider = new DeterministicReasoningProvider();

function baseInput(over: Partial<RenewalBriefInput> = {}): RenewalBriefInput {
  return {
    accountId: "a",
    subscriptionId: "s",
    vendorName: "Datadog",
    productName: "Pro",
    billingCycle: "annual",
    annualValueCents: 8_400_000,
    autoRenew: true,
    noticePeriodDays: 30,
    termEndDate: "2026-12-31",
    daysUntilNoticeDeadline: 9,
    noticeDeadlineMissed: false,
    hasPriceIncreaseClause: true,
    priceIncreaseClauseText: "Fees increase by up to 7% annually.",
    chargeHistory: [
      { effectiveDate: "2025-01-01", totalAnnualizedCents: 7_200_000, source: "term_start", refId: null },
      { effectiveDate: "2026-01-01", totalAnnualizedCents: 8_400_000, source: "price_changed", refId: "ev1" },
    ],
    benchmark: {
      sampleAccounts: 6,
      typicalNoticePeriodDays: 30,
      autoRenewRatePct: 80,
      medianAnnualValueCents: 6_000_000,
      topLevers: [{ lever: "competing_quote", count: 4 }],
      medianSavingsAnnualCents: 1_200_000,
    },
    priorDecisions: [
      { decision: "renewed_with_adjustments", negotiationLever: "competing_quote", savedAnnualUsdCents: 900_000, decidedAt: "2025-01-05" },
    ],
    ...over,
  };
}

afterEach(() => _resetReasoningProviderForTests());

describe("DeterministicReasoningProvider", () => {
  it("composes a full brief with a prediction and multiple evidenced claims", async () => {
    const brief = await provider.buildBrief(baseInput());
    expect(brief.meta.engine).toBe("deterministic");
    expect(brief.predictedNextAnnualCents).not.toBeNull();
    // rising trajectory + clause + above-median + urgency → renegotiate
    expect(brief.recommendedAction).toBe("renewed_with_adjustments");
    const keys = brief.claims.map((c) => c.key);
    expect(keys).toContain("price_trajectory");
    expect(keys).toContain("benchmark_position");
    expect(keys).toContain("renewal_risk");
    expect(keys).toContain("recommended_action");
    // every emitted claim carries evidence + integer confidence + honest engine
    for (const c of brief.claims) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(Number.isInteger(c.confidencePct)).toBe(true);
      expect(c.engine).toBe("deterministic");
    }
  });

  it("projects the next renewal from the account's own price history (OLS)", async () => {
    const brief = await provider.buildBrief(baseInput());
    // 7.2M → 8.4M over one year; projecting one more year ≈ 9.6M
    expect(brief.predictedNextAnnualCents!.point).toBeGreaterThan(9_000_000);
    expect(brief.predictedNextAnnualCents!.point).toBeLessThan(10_200_000);
  });

  it("is deterministic — identical input yields identical output", async () => {
    const a = await provider.buildBrief(baseInput());
    const b = await provider.buildBrief(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("suppresses the benchmark claim below the sample floor (no fabrication)", async () => {
    const brief = await provider.buildBrief(baseInput({ benchmark: null }));
    expect(brief.claims.find((c) => c.key === "benchmark_position")).toBeUndefined();
  });

  it("suppresses the trajectory + prediction with < 2 charge points", async () => {
    const brief = await provider.buildBrief(
      baseInput({
        chargeHistory: [
          { effectiveDate: "2026-01-01", totalAnnualizedCents: 8_400_000, source: "term_start", refId: null },
        ],
      })
    );
    expect(brief.predictedNextAnnualCents).toBeNull();
    expect(brief.claims.find((c) => c.key === "price_trajectory")).toBeUndefined();
  });

  it("penalizes recommendation confidence when signals disagree", async () => {
    // rising trajectory but BELOW median → conflict → lower confidence
    const conflicting = await provider.buildBrief(
      baseInput({
        annualValueCents: 4_000_000, // below the 6M median
        benchmark: {
          sampleAccounts: 6,
          typicalNoticePeriodDays: 30,
          autoRenewRatePct: 80,
          medianAnnualValueCents: 6_000_000,
          topLevers: [],
          medianSavingsAnnualCents: null,
        },
      })
    );
    const agreeing = await provider.buildBrief(baseInput());
    const cRec = conflicting.claims.find((c) => c.key === "recommended_action")!;
    const aRec = agreeing.claims.find((c) => c.key === "recommended_action")!;
    expect(cRec.confidencePct).toBeLessThan(aRec.confidencePct);
  });

  it("missed notice deadline → deferred recommendation", async () => {
    const brief = await provider.buildBrief(
      baseInput({ noticeDeadlineMissed: true })
    );
    expect(brief.recommendedAction).toBe("deferred");
  });
});

describe("validateBrief — honesty enforcement", () => {
  it("drops a claim with empty evidence", () => {
    const brief: RenewalIntelligenceBrief = {
      meta: { provider: "x", model: "m", promptVersion: "v", confidencePct: 50, engine: "llm", briefVersion: "b" },
      headline: "",
      recommendedAction: "renewed",
      claims: [
        { key: "leverage", statement: "no receipts", engine: "llm", confidencePct: 80, evidence: [] },
        { key: "renewal_risk", statement: "ok", engine: "llm", confidencePct: 70, evidence: [{ source: "notice_deadline", detail: "x", quote: null, refId: null }] },
      ],
      predictedNextAnnualCents: null,
    };
    const out = validateBrief(brief, { clauseText: null });
    expect(out.claims.map((c) => c.key)).toEqual(["renewal_risk"]);
  });

  it("drops a claim whose quote is not verbatim in the clause", () => {
    const brief: RenewalIntelligenceBrief = {
      meta: { provider: "x", model: "m", promptVersion: "v", confidencePct: 50, engine: "llm", briefVersion: "b" },
      headline: "",
      recommendedAction: "renewed",
      claims: [
        { key: "renewal_risk", statement: "fabricated", engine: "llm", confidencePct: 70, evidence: [{ source: "price_increase_clause", detail: "x", quote: "fees triple every month", refId: null }] },
      ],
      predictedNextAnnualCents: null,
    };
    const out = validateBrief(brief, { clauseText: "Fees increase by up to 7% annually." });
    expect(out.claims).toHaveLength(0);
  });
});

describe("getReasoningProvider provenance", () => {
  it("defaults to the deterministic reasoner with no flag/key", () => {
    delete process.env.AI_REASONING_PROVIDER;
    _resetReasoningProviderForTests();
    expect(getReasoningProvider().providerName).toBe("deterministic-reasoner");
  });

  it("falls back to deterministic when anthropic is selected without a key", () => {
    process.env.AI_REASONING_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    _resetReasoningProviderForTests();
    expect(getReasoningProvider().providerName).toBe("deterministic-reasoner");
    delete process.env.AI_REASONING_PROVIDER;
    _resetReasoningProviderForTests();
  });
});
