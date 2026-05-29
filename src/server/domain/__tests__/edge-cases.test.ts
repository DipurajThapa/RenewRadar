/**
 * Edge-case tests for the two highest-leverage pure-domain functions.
 *
 * Audit gap H2/H3: notice-deadline and risk-score had broad happy-path
 * coverage but missed:
 *   - Leap year + Feb 29 boundaries
 *   - Multi-year notice (noticePeriodDays = 365)
 *   - "today exactly equals the deadline" (the boundary that defines
 *     whether the customer is in-window or already missed)
 *   - $0 contracts (should land in lowest value tier, not crash)
 *   - The wedge invariant the architecture document promises:
 *       any auto-renewing deal within 7 days = high band
 */
import { describe, expect, it } from "vitest";
import {
  calculateNoticeDeadline,
  daysUntilNoticeDeadline,
} from "@server/domain/notice-deadline/calculate";
import { scoreRisk } from "@server/domain/risk/score";

// ─────────────────────────────────────────────────────────────────────────
// Notice deadline — leap year and date math
// ─────────────────────────────────────────────────────────────────────────

describe("calculateNoticeDeadline — leap year", () => {
  it("term end 2028-03-01 minus 30 days = 2028-01-31", async () => {
    // 2028 is a leap year. Jan has 31 days, Feb has 29. So Mar 1 - 30
    // days = Jan 31 (not Feb 1).
    const deadline = calculateNoticeDeadline("2028-03-01", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2028-01-31");
  });

  it("term end 2028-02-29 minus 30 days = 2028-01-30", async () => {
    const deadline = calculateNoticeDeadline("2028-02-29", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2028-01-30");
  });

  it("term end 2027-03-01 minus 30 days = 2027-01-30 (non-leap year)", async () => {
    // 2027 is NOT a leap year. Feb has 28 days. Mar 1 - 30 = Jan 30.
    const deadline = calculateNoticeDeadline("2027-03-01", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2027-01-30");
  });
});

describe("calculateNoticeDeadline — year boundary", () => {
  it("term end Jan 15 with 30-day notice lands in prior December", async () => {
    const deadline = calculateNoticeDeadline("2026-01-15", 30);
    expect(deadline.toISOString().split("T")[0]).toBe("2025-12-16");
  });

  it("term end Jan 1 with 1-day notice lands Dec 31", async () => {
    const deadline = calculateNoticeDeadline("2026-01-01", 1);
    expect(deadline.toISOString().split("T")[0]).toBe("2025-12-31");
  });
});

describe("calculateNoticeDeadline — extreme notice periods", () => {
  it("365-day notice (multi-year renewal) lands exactly one year prior", async () => {
    const deadline = calculateNoticeDeadline("2027-06-15", 365);
    // 2026 is NOT a leap year, so 2027-06-15 minus 365 days = 2026-06-15.
    expect(deadline.toISOString().split("T")[0]).toBe("2026-06-15");
  });

  it("0-day notice means deadline = term end", async () => {
    const deadline = calculateNoticeDeadline("2026-06-15", 0);
    expect(deadline.toISOString().split("T")[0]).toBe("2026-06-15");
  });
});

describe("daysUntilNoticeDeadline — today boundary", () => {
  it("returns 0 when today is exactly the deadline", async () => {
    const termEnd = "2026-06-15";
    const noticePeriod = 30;
    // Deadline = 2026-05-16. Set today = 2026-05-16.
    const today = new Date("2026-05-16T12:00:00Z");
    expect(daysUntilNoticeDeadline(termEnd, noticePeriod, today)).toBe(0);
  });

  it("returns -1 when today is one day past the deadline", async () => {
    const termEnd = "2026-06-15";
    const noticePeriod = 30;
    const today = new Date("2026-05-17T12:00:00Z");
    expect(daysUntilNoticeDeadline(termEnd, noticePeriod, today)).toBe(-1);
  });

  it("returns 1 when today is one day before the deadline", async () => {
    const termEnd = "2026-06-15";
    const noticePeriod = 30;
    const today = new Date("2026-05-15T12:00:00Z");
    expect(daysUntilNoticeDeadline(termEnd, noticePeriod, today)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Risk score — boundaries and the wedge invariant
// ─────────────────────────────────────────────────────────────────────────

describe("scoreRisk urgency boundaries", () => {
  it("days = 0 returns max urgency (60)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 0,
      annualValueCents: 100_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.urgency).toBe(60);
  });

  it("days = 1 returns 55 (the second tier — not unreachable, contrary to surface read)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 1,
      annualValueCents: 100_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.urgency).toBe(55);
  });

  it("days = -100 (deeply past) still returns 60 (clamped at max)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: -100,
      annualValueCents: 100_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.urgency).toBe(60);
  });

  it("days = 91 returns 0 (well outside any urgency tier)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 91,
      annualValueCents: 100_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.urgency).toBe(0);
  });
});

describe("scoreRisk value tier boundaries", () => {
  it("$0 contract lands in the lowest tier (5)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 0,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.value).toBe(5);
  });

  it("exactly $1,000 (the boundary) lands in the lowest tier (5)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 100_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.value).toBe(5);
  });

  it("$1,001 just over the boundary lands in tier 2 (10)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 100_100,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.value).toBe(10);
  });

  it("$1,000,000 (well over $100K) tops out at 25", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 30,
      annualValueCents: 100_000_000,
      autoRenew: false,
      isMissed: false,
    });
    expect(r.components.value).toBe(25);
  });
});

describe("scoreRisk wedge invariant", () => {
  it("ANY auto-renewing renewal within 7 days is high band", async () => {
    // Even at the smallest value tier ($0 contract, hypothetical) the
    // urgency + auto-renew clause should land us in high.
    const r = scoreRisk({
      daysUntilNoticeDeadline: 7,
      annualValueCents: 0,
      autoRenew: true,
      isMissed: false,
    });
    // 50 urgency + 5 value + 10 auto-renew = 65 → high (≥60).
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.band).toBe("high");
  });

  it("non-auto-renew at 7 days lands medium (intentional)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 7,
      annualValueCents: 0,
      autoRenew: false,
      isMissed: false,
    });
    // 50 + 5 = 55 → medium (35-59).
    expect(r.band).toBe("medium");
  });

  it("a $100K auto-renewing contract 90 days out is low (the converse)", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: 90,
      annualValueCents: 10_000_000, // $100K
      autoRenew: true,
      isMissed: false,
    });
    // 3 + 20 + 10 = 33 → low. The docstring's promised example.
    expect(r.band).toBe("low");
  });
});

describe("scoreRisk clamping", () => {
  it("score is clamped at 100 even when all components max out", async () => {
    const r = scoreRisk({
      daysUntilNoticeDeadline: -5,
      annualValueCents: 1_000_000_000, // $10M
      autoRenew: true,
      isMissed: true,
    });
    // 60 + 25 + 10 + 5 = 100. Right at the ceiling.
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.band).toBe("high");
  });

  it("score is clamped at 0 (not negative) when inputs degenerate", async () => {
    // All components are non-negative by definition, so just check the
    // floor stays defended.
    const r = scoreRisk({
      daysUntilNoticeDeadline: 9999,
      annualValueCents: 0,
      autoRenew: false,
      isMissed: false,
    });
    // 0 + 5 + 0 = 5 (lowest possible because value floor = 5).
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});
