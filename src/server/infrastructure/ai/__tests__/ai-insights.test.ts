/**
 * Tests for the four AI insight methods on HeuristicStubProvider.
 *
 * The heuristic is deterministic by design: given the same input, the output
 * is byte-identical. This makes it useful both as a dev stub and as a
 * regression guard — the templates here are the contract the production
 * Anthropic provider will need to match in shape and tone.
 */
import { describe, expect, it } from "vitest";
import { HeuristicStubProvider } from "@server/infrastructure/ai/heuristic-stub-provider";
import { AnthropicNotConfiguredProvider } from "@server/infrastructure/ai/anthropic-not-configured";
import {
  _resetExtractionProviderForTests,
  getExtractionProvider,
  getInsightProvider,
} from "@server/infrastructure/ai";

const provider = new HeuristicStubProvider();

describe("HeuristicStubProvider.explainRisk", () => {
  it("returns the 'already passed' headline for a missed notice deadline", async () => {
    const out = await provider.explainRisk({
      riskScore: 75,
      riskBand: "high",
      components: { urgency: 60, value: 15, clausePressure: 0 },
      daysUntilNoticeDeadline: -3,
      annualValueCents: 50_000_00,
      autoRenew: false,
      isMissed: true,
      vendorName: "Atlassian",
      productName: "Jira Standard",
    });
    expect(out.headline.toLowerCase()).toContain("has passed");
    expect(out.rationale).toMatch(/3 days ago/);
    expect(out.meta.confidencePct).toBeGreaterThanOrEqual(90);
    expect(out.suggestedActions.length).toBeGreaterThan(0);
  });

  it("flags auto-renew as a reason when explaining a high-risk row", async () => {
    const out = await provider.explainRisk({
      riskScore: 78,
      riskBand: "high",
      components: { urgency: 50, value: 20, clausePressure: 10 },
      daysUntilNoticeDeadline: 5,
      annualValueCents: 150_000_00,
      autoRenew: true,
      isMissed: false,
      vendorName: "Salesforce",
      productName: "Sales Cloud",
    });
    expect(out.rationale).toContain("auto-renew");
    expect(out.rationale).toContain("5 days");
    expect(out.headline).toContain("Sales Cloud");
  });

  it("reports lower confidence for low-band explanations", async () => {
    const out = await provider.explainRisk({
      riskScore: 18,
      riskBand: "low",
      components: { urgency: 3, value: 10, clausePressure: 0 },
      daysUntilNoticeDeadline: 120,
      annualValueCents: 5_000_00,
      autoRenew: false,
      isMissed: false,
      vendorName: "Loom",
      productName: "Loom Business",
    });
    expect(out.meta.confidencePct).toBeLessThanOrEqual(70);
    expect(out.headline).toContain("low urgency");
  });
});

describe("HeuristicStubProvider.summarizeVendorIntelligence", () => {
  it("highlights savings and frames a multi-year relationship", async () => {
    const out = await provider.summarizeVendorIntelligence({
      vendorName: "Atlassian",
      yearsTracked: 3,
      activeSubscriptions: 2,
      cancelledSubscriptions: 1,
      totalSavedAnnualCents: 12_000_00,
      averagePriceChangePct: 6.2,
      lastDecisionLabel: "renewed_with_adjustments",
      lastDecisionDate: "Jan 15, 2025",
      complianceArtifacts: 2,
      expiringComplianceArtifacts: 0,
    });
    expect(out.summary).toContain("Atlassian");
    expect(out.summary).toContain("3 year");
    expect(out.summary).toContain("$12K saved");
    expect(out.highlights.some((h) => h.includes("upward"))).toBe(true);
    expect(out.highlights.some((h) => h.includes("cancelled"))).toBe(true);
  });

  it("falls back to a low-confidence response when there's no history yet", async () => {
    const out = await provider.summarizeVendorIntelligence({
      vendorName: "Notion",
      yearsTracked: 0.2,
      activeSubscriptions: 1,
      cancelledSubscriptions: 0,
      totalSavedAnnualCents: 0,
      averagePriceChangePct: null,
      lastDecisionLabel: null,
      lastDecisionDate: null,
      complianceArtifacts: 0,
      expiringComplianceArtifacts: 0,
    });
    expect(out.meta.confidencePct).toBeLessThan(60);
    expect(out.summary).toContain("less than a year");
    expect(
      out.highlights.some((h) => h.toLowerCase().includes("no multi-renewal"))
    ).toBe(true);
  });

  it("surfaces expiring compliance artifacts as an actionable highlight", async () => {
    const out = await provider.summarizeVendorIntelligence({
      vendorName: "Datadog",
      yearsTracked: 2,
      activeSubscriptions: 1,
      cancelledSubscriptions: 0,
      totalSavedAnnualCents: 0,
      averagePriceChangePct: 0,
      lastDecisionLabel: null,
      lastDecisionDate: null,
      complianceArtifacts: 3,
      expiringComplianceArtifacts: 1,
    });
    expect(out.highlights.some((h) => h.toLowerCase().includes("expiring"))).toBe(true);
  });
});

describe("HeuristicStubProvider.recommendRenewalDecision", () => {
  it("defers when the notice deadline has already passed", async () => {
    const out = await provider.recommendRenewalDecision({
      vendorName: "Atlassian",
      productName: "Jira",
      annualValueCents: 12_000_00,
      autoRenew: true,
      daysUntilNoticeDeadline: -2,
      riskBand: "high",
      hasPriceIncreaseClause: true,
      pastSavingsAnnualCents: 0,
      noticeDeadlineMissed: true,
    });
    expect(out.recommendation).toBe("deferred");
    expect(out.rationale.toLowerCase()).toContain("closed");
    expect(out.meta.confidencePct).toBeGreaterThanOrEqual(85);
  });

  it("recommends renegotiation when the contract carries a price-increase clause", async () => {
    const out = await provider.recommendRenewalDecision({
      vendorName: "Salesforce",
      productName: "Sales Cloud",
      annualValueCents: 200_000_00,
      autoRenew: true,
      daysUntilNoticeDeadline: 25,
      riskBand: "high",
      hasPriceIncreaseClause: true,
      pastSavingsAnnualCents: 0,
      noticeDeadlineMissed: false,
    });
    expect(out.recommendation).toBe("renewed_with_adjustments");
    expect(out.negotiationLevers.length).toBeGreaterThan(0);
    expect(out.rationale).toContain("price-increase");
  });

  it("recommends a flat renewal for small low-risk contracts", async () => {
    const out = await provider.recommendRenewalDecision({
      vendorName: "Loom",
      productName: "Business",
      annualValueCents: 600_00,
      autoRenew: false,
      daysUntilNoticeDeadline: 40,
      riskBand: "low",
      hasPriceIncreaseClause: false,
      pastSavingsAnnualCents: 0,
      noticeDeadlineMissed: false,
    });
    expect(out.recommendation).toBe("renewed");
  });
});

describe("HeuristicStubProvider.narrateSavings", () => {
  it("frames a cancellation as money returned to the budget", async () => {
    const out = await provider.narrateSavings({
      vendorName: "Calendly",
      productName: "Team",
      kind: "cancelled",
      baselineAnnualUsdCents: 3_000_00,
      newAnnualUsdCents: 0,
      savedAnnualUsdCents: 3_000_00,
      negotiationLever: null,
      rationaleCodes: [],
    });
    expect(out.narrative.toLowerCase()).toContain("cancelled");
    expect(out.narrative).toContain("$3");
    expect(out.meta.confidencePct).toBeGreaterThanOrEqual(90);
  });

  it("names the negotiation lever for a renegotiated row", async () => {
    const out = await provider.narrateSavings({
      vendorName: "Atlassian",
      productName: "Jira",
      kind: "renegotiated",
      baselineAnnualUsdCents: 20_000_00,
      newAnnualUsdCents: 15_000_00,
      savedAnnualUsdCents: 5_000_00,
      negotiationLever: "multi_year_commit",
      rationaleCodes: ["cost_reduction"],
    });
    expect(out.narrative.toLowerCase()).toContain("multi-year");
  });

  it("uses the flat-renewal copy when nothing was saved", async () => {
    const out = await provider.narrateSavings({
      vendorName: "Sentry",
      productName: "Team",
      kind: "renegotiated",
      baselineAnnualUsdCents: 9_000_00,
      newAnnualUsdCents: 9_000_00,
      savedAnnualUsdCents: 0,
      negotiationLever: null,
      rationaleCodes: [],
    });
    expect(out.narrative.toLowerCase()).toContain("flat renewal");
    expect(out.narrative).toContain("Team");
  });
});

describe("Heuristic stub: pagesCharged accounting", () => {
  it("uses pageCount when supplied", async () => {
    const result = await provider.extract({
      text: "Hello world",
      pageCount: 7,
    });
    expect(result.meta.pagesCharged).toBe(7);
  });

  it("derives from pageBreaks when pageCount is absent (PDF case)", async () => {
    // 5-page document → pageBreaks has 4 entries (boundaries between pages).
    const result = await provider.extract({
      text: "x".repeat(5_000),
      pageBreaks: [1_000, 2_000, 3_000, 4_000],
    });
    expect(result.meta.pagesCharged).toBe(5);
  });

  it("falls back to 1 for plain text / DOCX with no page hints", async () => {
    const result = await provider.extract({ text: "a brief plain note" });
    expect(result.meta.pagesCharged).toBe(1);
  });
});

describe("AnthropicNotConfiguredProvider", () => {
  const anthropic = new AnthropicNotConfiguredProvider();

  it("throws the documented setup error on extract", async () => {
    await expect(
      anthropic.extract({ text: "any" })
    ).rejects.toThrow(/Anthropic provider is not configured/);
  });

  it("throws on each of the four insight methods", async () => {
    const sharedHandler = (p: Promise<unknown>) =>
      expect(p).rejects.toThrow(/Anthropic provider is not configured/);
    await sharedHandler(
      anthropic.explainRisk({
        riskScore: 50,
        riskBand: "medium",
        components: { urgency: 20, value: 10, clausePressure: 0 },
        daysUntilNoticeDeadline: 15,
        annualValueCents: 10_000_00,
        autoRenew: true,
        isMissed: false,
        vendorName: "x",
        productName: "y",
      })
    );
    await sharedHandler(
      anthropic.summarizeVendorIntelligence({
        vendorName: "x",
        yearsTracked: 1,
        activeSubscriptions: 1,
        cancelledSubscriptions: 0,
        totalSavedAnnualCents: 0,
        averagePriceChangePct: null,
        lastDecisionLabel: null,
        lastDecisionDate: null,
        complianceArtifacts: 0,
        expiringComplianceArtifacts: 0,
      })
    );
    await sharedHandler(
      anthropic.recommendRenewalDecision({
        vendorName: "x",
        productName: "y",
        annualValueCents: 10_000_00,
        autoRenew: false,
        daysUntilNoticeDeadline: 10,
        riskBand: "low",
        hasPriceIncreaseClause: false,
        pastSavingsAnnualCents: 0,
        noticeDeadlineMissed: false,
      })
    );
    await sharedHandler(
      anthropic.narrateSavings({
        vendorName: "x",
        productName: "y",
        kind: "cancelled",
        baselineAnnualUsdCents: 1_000_00,
        newAnnualUsdCents: 0,
        savedAnnualUsdCents: 1_000_00,
        negotiationLever: null,
        rationaleCodes: [],
      })
    );
  });
});

describe("AI factory env behavior", () => {
  it("falls back to heuristic when ANTHROPIC_API_KEY is missing", () => {
    _resetExtractionProviderForTests(null);
    const prev = process.env.AI_EXTRACTION_PROVIDER;
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.AI_EXTRACTION_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const extractor = getExtractionProvider();
      expect(extractor.providerName).toBe("heuristic-stub");
      // The insight provider is the SAME instance (single shared cache) —
      // confirms factory consolidation.
      const insight = getInsightProvider();
      expect(insight.providerName).toBe("heuristic-stub");
    } finally {
      process.env.AI_EXTRACTION_PROVIDER = prev;
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
      _resetExtractionProviderForTests(null);
    }
  });

  it("instantiates the not-configured Anthropic provider when key is present", () => {
    _resetExtractionProviderForTests(null);
    const prev = process.env.AI_EXTRACTION_PROVIDER;
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.AI_EXTRACTION_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-test-only-not-real";
    try {
      const extractor = getExtractionProvider();
      expect(extractor.providerName).toBe("anthropic");
    } finally {
      process.env.AI_EXTRACTION_PROVIDER = prev;
      if (prevKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = prevKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
      _resetExtractionProviderForTests(null);
    }
  });
});
