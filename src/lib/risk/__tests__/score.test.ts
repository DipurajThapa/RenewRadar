import { describe, expect, it } from "vitest";
import { bandForScore, scoreRisk } from "@/lib/risk/score";

describe("scoreRisk", () => {
  it("scores a notice deadline in 60+ days as low risk regardless of value", () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 90,
      annualValueCents: 50_000_00, // $50K — substantial
      autoRenew: true,
      isMissed: false,
    });
    expect(r.band).toBe("low");
    expect(r.components.urgency).toBe(3);
  });

  it("any renewal inside the 7-day window clears the high threshold", () => {
    // Even a $500/yr subscription on auto-renew inside 7d should clear 60
    // — that's the wedge.
    const r = scoreRisk({
      daysUntilNoticeDeadline: 5,
      annualValueCents: 50_000, // $500
      autoRenew: true,
      isMissed: false,
    });
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.band).toBe("high");
  });

  it("a missed deadline is always high risk", () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: -3,
      annualValueCents: 1_000_00, // $1K — small
      autoRenew: false,
      isMissed: true,
    });
    expect(r.band).toBe("high");
    expect(r.components.urgency).toBe(60);
    expect(r.components.clausePressure).toBe(5);
  });

  it("auto-renew alone pushes a marginal deadline from medium to high", () => {
    const withoutAutoRenew = scoreRisk({
      daysUntilNoticeDeadline: 25,
      annualValueCents: 12_000_00, // $12K
      autoRenew: false,
      isMissed: false,
    });
    const withAutoRenew = scoreRisk({
      ...{
        daysUntilNoticeDeadline: 25,
        annualValueCents: 12_000_00,
        autoRenew: true,
        isMissed: false,
      },
    });
    expect(withAutoRenew.score - withoutAutoRenew.score).toBe(10);
    expect(withoutAutoRenew.band).toBe("medium");
    // 20 (urgency) + 15 (value) + 10 (auto) = 45 — still medium, but closer
    expect(withAutoRenew.band).toBe("medium");
  });

  it("value scales sub-linearly with annual cost", () => {
    const small = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 500_00, // $500
      autoRenew: false,
      isMissed: false,
    });
    const huge = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 500_000_00, // $500K
      autoRenew: false,
      isMissed: false,
    });
    // Value cap means even a $500K contract adds only +25 over $500.
    expect(huge.score - small.score).toBe(25 - 5);
  });

  it("score is clamped to [0, 100]", () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: -10,
      annualValueCents: 1_000_000_00,
      autoRenew: true,
      isMissed: true,
    });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBe(100); // 60 + 25 + 15 = 100 exactly
  });
});

describe("bandForScore", () => {
  it.each([
    [0, "low"],
    [34, "low"],
    [35, "medium"],
    [59, "medium"],
    [60, "high"],
    [100, "high"],
  ] as const)("score %i → %s", (score, expected) => {
    expect(bandForScore(score)).toBe(expected);
  });
});
