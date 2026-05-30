import { describe, expect, it } from "vitest";
import { urgencyScore } from "@server/domain/needs-you/rank";

describe("urgencyScore", () => {
  it("maxes out for an overdue deadline", () => {
    expect(urgencyScore({ daysUntilDeadline: -1 })).toBe(100);
    expect(urgencyScore({ daysUntilDeadline: -30, intrinsic: 0 })).toBe(100);
  });

  it("rises as a deadline approaches", () => {
    expect(urgencyScore({ daysUntilDeadline: 0 })).toBe(100);
    expect(urgencyScore({ daysUntilDeadline: 10 })).toBe(80);
    expect(urgencyScore({ daysUntilDeadline: 50 })).toBe(0);
  });

  it("never falls below the intrinsic signal when a deadline is far out", () => {
    // 50 days out → proximity 0, but a high-risk renewal still scores its risk.
    expect(urgencyScore({ daysUntilDeadline: 50, intrinsic: 70 })).toBe(70);
  });

  it("is age-driven (and capped) when there's no deadline", () => {
    expect(urgencyScore({ ageDays: 3 })).toBe(15);
    expect(urgencyScore({ ageDays: 100 })).toBe(75); // capped at 75
  });

  it("falls back to the intrinsic signal when neither deadline nor age is given", () => {
    expect(urgencyScore({ intrinsic: 90 })).toBe(90);
    expect(urgencyScore({})).toBe(10);
  });

  it("clamps to 0..100", () => {
    expect(urgencyScore({ intrinsic: 999 })).toBe(100);
    expect(urgencyScore({ intrinsic: -50 })).toBe(0);
  });
});
