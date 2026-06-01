import { describe, expect, it } from "vitest";
import {
  assembleActionPackage,
  type AssembleActionPackageInput,
} from "@server/application/action-package";
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";
import type { RenewalItemFacts } from "@server/domain/provenance/missing-info";

const completeFacts: RenewalItemFacts = {
  category: "saas_subscription",
  termEndDate: "2026-12-01",
  noticePeriodDays: 30,
  totalCostPerPeriodCents: 12_000_00,
  cancellationMethodCode: "email",
  priceIncreaseClauseText: "5% cap",
  attributes: {},
};

const brief = (over: Partial<RenewalIntelligenceBrief> = {}): RenewalIntelligenceBrief => ({
  meta: {
    provider: "x",
    model: "m",
    promptVersion: "1",
    confidencePct: 88,
    engine: "deterministic",
    briefVersion: "1",
  },
  headline: "Renegotiate before the notice window closes.",
  recommendedAction: "renewed_with_adjustments",
  claims: [
    {
      key: "recommended_action",
      statement: "Push for a price hold.",
      engine: "deterministic",
      confidencePct: 88,
      evidence: [
        { source: "benchmark", detail: "d", quote: null, refId: null },
      ],
    },
    {
      key: "leverage",
      statement: "You are 20% above the benchmark.",
      engine: "deterministic",
      confidencePct: 80,
      evidence: [
        { source: "benchmark", detail: "d", quote: null, refId: null },
      ],
    },
  ],
  predictedNextAnnualCents: null,
  ...over,
});

const base: AssembleActionPackageInput = {
  vendorName: "Acme",
  productName: "Pro",
  facts: completeFacts,
  noticeDeadline: "2026-11-01",
  renewalDate: "2026-12-01",
  daysUntilNoticeDeadline: 20,
  brief: brief(),
  briefBySystem: false,
  hasNoticeDraft: true,
  noticeDraftBySystem: false,
  uncertainSignals: [],
  icsHref: "/api/calendar/item/sub-1",
};

describe("assembleActionPackage", () => {
  it("rides the brief for the recommendation + its provenance band", () => {
    const pkg = assembleActionPackage(base);
    expect(pkg.recommendedAction).toBe("renewed_with_adjustments");
    expect(pkg.recommendationProvenance).toBe("verified"); // 88% + evidence
    expect(pkg.headline).toContain("Renegotiate");
  });

  it("emits no recommendation when there is no brief", () => {
    const pkg = assembleActionPackage({ ...base, brief: null });
    expect(pkg.recommendedAction).toBeNull();
    expect(pkg.recommendationProvenance).toBeNull();
    expect(pkg.headline).toBeNull();
  });

  it("asks no vendor questions when nothing is missing (beyond the leverage prompt)", () => {
    const pkg = assembleActionPackage(base);
    // Only the leverage talking point — no missing-fact questions.
    expect(pkg.missingInfo).toEqual([]);
    expect(pkg.vendorQuestions).toHaveLength(1);
    expect(pkg.vendorQuestions[0]).toContain("Raise in negotiation");
  });

  it("turns each missing fact into a question", () => {
    const bareFacts: RenewalItemFacts = {
      category: "saas_subscription",
      termEndDate: null,
      noticePeriodDays: 0,
      totalCostPerPeriodCents: 0,
      cancellationMethodCode: null,
      priceIncreaseClauseText: null,
      attributes: {},
    };
    const pkg = assembleActionPackage({
      ...base,
      facts: bareFacts,
      brief: null,
    });
    expect(pkg.missingInfo.length).toBeGreaterThanOrEqual(5);
    expect(pkg.vendorQuestions.length).toBe(pkg.missingInfo.length);
    expect(pkg.vendorQuestions.some((q) => /notice period/i.test(q))).toBe(true);
  });

  it("flags preparedBySystem when the brief was agent-prepped", () => {
    expect(assembleActionPackage({ ...base, briefBySystem: true }).preparedBySystem).toBe(true);
    expect(
      assembleActionPackage({ ...base, noticeDraftBySystem: true }).preparedBySystem
    ).toBe(true);
    expect(assembleActionPackage(base).preparedBySystem).toBe(false);
  });

  it("reminder line reflects a closed notice window", () => {
    const pkg = assembleActionPackage({
      ...base,
      daysUntilNoticeDeadline: -3,
    });
    expect(pkg.reminderLine).toMatch(/closed 3 day/);
  });

  it("reminder line handles a missing deadline", () => {
    const pkg = assembleActionPackage({ ...base, noticeDeadline: null });
    expect(pkg.reminderLine).toMatch(/No notice deadline/);
  });
});
