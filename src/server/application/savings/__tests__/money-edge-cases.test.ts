/**
 * Money & numeric edge cases — investor-grade boundary tests.
 *
 * derive-savings.test.ts pins the branch logic. This file pins the
 * boundary inputs that would surface as rendering bugs or revenue-trust
 * issues if they ever drifted:
 *
 *   - Zero baseline (a genuinely $0 subscription)
 *   - Very large amounts (close to 32-bit signed cents = ~$21M)
 *   - Pennies-only granularity (rounding stability)
 *   - "Cost went up" (worse outcome) — pinned in derive-savings.test.ts;
 *     we also pin the inverse (re-checking the clamp under large inputs).
 */
import { describe, expect, it } from "vitest";
import { deriveSavings } from "@server/application/savings";

const INT32_CENTS_MAX = 2_147_483_647; // $21,474,836.47 — db column upper bound

describe("deriveSavings: $0 baseline", () => {
  it("cancellation of a $0 subscription saves $0", () => {
    expect(
      deriveSavings({ kind: "cancelled", baselineAnnualUsdCents: 0 })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 0 });
  });

  it("renegotiating a $0 baseline never produces phantom savings", () => {
    // baseline=0, new=0 ⇒ saved=0. Confirms the floor below.
    expect(
      deriveSavings({
        kind: "renegotiated",
        baselineAnnualUsdCents: 0,
        newAnnualUsdCents: 0,
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 0 });
  });

  it("avoided_increase on $0 baseline is $0 saved (degenerate case)", () => {
    expect(
      deriveSavings({
        kind: "avoided_increase",
        baselineAnnualUsdCents: 0,
        newAnnualUsdCents: 0,
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 0 });
  });
});

describe("deriveSavings: large amounts near the int32 cents ceiling", () => {
  // ~$21,474,836 — the upper bound for a PG `integer` column. Subscription
  // costs above this would not fit anyway, so we test the meaningful upper
  // edge of legal input rather than the JS Number boundary.

  it("handles a cancellation at the int32 ceiling without overflow", () => {
    const r = deriveSavings({
      kind: "cancelled",
      baselineAnnualUsdCents: INT32_CENTS_MAX,
    });
    expect(r.savedAnnualUsdCents).toBe(INT32_CENTS_MAX);
    expect(r.newAnnualUsdCents).toBe(0);
    expect(Number.isInteger(r.savedAnnualUsdCents)).toBe(true);
  });

  it("renegotiating from $20M to $10M reports the exact delta", () => {
    const r = deriveSavings({
      kind: "renegotiated",
      baselineAnnualUsdCents: 2_000_000_00, // $2,000,000
      newAnnualUsdCents: 1_000_000_00, // $1,000,000
    });
    expect(r.savedAnnualUsdCents).toBe(1_000_000_00);
  });

  it("the worse-outcome clamp still holds at the upper edge", () => {
    // newAnnual > INT32_CENTS_MAX is invalid input, but the clamp logic
    // must still return 0 saved, not a negative number, when callers
    // pass garbage. Pinning this means a UI bug that double-counts seats
    // can never surface as fake "negative savings" on the dashboard.
    const r = deriveSavings({
      kind: "renegotiated",
      baselineAnnualUsdCents: 1_000_000,
      newAnnualUsdCents: 2_000_000_000,
    });
    expect(r.savedAnnualUsdCents).toBe(0);
  });
});

describe("deriveSavings: penny-level granularity", () => {
  it("preserves integer cents through subtraction (no float drift)", () => {
    // 1234567 − 987654 must be exactly 246913, not 246912.99999...
    const r = deriveSavings({
      kind: "renegotiated",
      baselineAnnualUsdCents: 1_234_567,
      newAnnualUsdCents: 987_654,
    });
    expect(r.savedAnnualUsdCents).toBe(246_913);
    expect(Number.isInteger(r.savedAnnualUsdCents)).toBe(true);
  });

  it("a 1-cent renegotiation savings rounds cleanly to 1 cent", () => {
    expect(
      deriveSavings({
        kind: "renegotiated",
        baselineAnnualUsdCents: 100,
        newAnnualUsdCents: 99,
      }).savedAnnualUsdCents
    ).toBe(1);
  });
});
