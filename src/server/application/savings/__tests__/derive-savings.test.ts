/**
 * deriveSavings contract tests.
 *
 * The savings ledger is a customer-facing dollar figure. A miscalculation
 * here either makes the product look better than it is or worse than it is;
 * both undermine trust. These tests pin every branch.
 */
import { describe, expect, it } from "vitest";
import { deriveSavings } from "@server/application/savings";

describe("deriveSavings", () => {
  it("cancellation saves the full baseline regardless of newAnnual input", () => {
    expect(
      deriveSavings({
        kind: "cancelled",
        baselineAnnualUsdCents: 1_200_000,
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 1_200_000 });
    expect(
      deriveSavings({
        kind: "cancelled",
        baselineAnnualUsdCents: 1_200_000,
        newAnnualUsdCents: 999_999, // ignored on cancellation
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 1_200_000 });
  });

  it("downgrade saves the delta when newAnnual is provided", () => {
    expect(
      deriveSavings({
        kind: "downgraded",
        baselineAnnualUsdCents: 1_200_000,
        newAnnualUsdCents: 700_000,
      })
    ).toEqual({ newAnnualUsdCents: 700_000, savedAnnualUsdCents: 500_000 });
  });

  it("downgrade with no newAnnual falls back to baseline (savings = 0)", () => {
    expect(
      deriveSavings({
        kind: "downgraded",
        baselineAnnualUsdCents: 800_000,
      })
    ).toEqual({ newAnnualUsdCents: 800_000, savedAnnualUsdCents: 0 });
  });

  it("renegotiation passes baseline + new through and computes saved", () => {
    expect(
      deriveSavings({
        kind: "renegotiated",
        baselineAnnualUsdCents: 1_000_000,
        newAnnualUsdCents: 850_000,
      })
    ).toEqual({ newAnnualUsdCents: 850_000, savedAnnualUsdCents: 150_000 });
  });

  it("avoided_increase mirrors renegotiation (saved = baseline − new)", () => {
    expect(
      deriveSavings({
        kind: "avoided_increase",
        baselineAnnualUsdCents: 1_000_000,
        newAnnualUsdCents: 900_000,
      })
    ).toEqual({ newAnnualUsdCents: 900_000, savedAnnualUsdCents: 100_000 });
  });

  it("clamps a worse outcome (new > baseline) to 0 saved, not negative", () => {
    expect(
      deriveSavings({
        kind: "renegotiated",
        baselineAnnualUsdCents: 1_000_000,
        newAnnualUsdCents: 1_200_000,
      })
    ).toEqual({ newAnnualUsdCents: 1_200_000, savedAnnualUsdCents: 0 });
  });

  it("clamps a negative baseline to 0 (defensive)", () => {
    expect(
      deriveSavings({
        kind: "cancelled",
        baselineAnnualUsdCents: -500,
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 0 });
  });

  it("clamps a negative newAnnual to 0 before computing savings", () => {
    expect(
      deriveSavings({
        kind: "renegotiated",
        baselineAnnualUsdCents: 1_000_000,
        newAnnualUsdCents: -200_000,
      })
    ).toEqual({ newAnnualUsdCents: 0, savedAnnualUsdCents: 1_000_000 });
  });

  it("returns integer cents — no floating-point artefacts at the dollar boundary", () => {
    const result = deriveSavings({
      kind: "renegotiated",
      baselineAnnualUsdCents: 99_999,
      newAnnualUsdCents: 33_333,
    });
    expect(Number.isInteger(result.savedAnnualUsdCents)).toBe(true);
    expect(result.savedAnnualUsdCents).toBe(66_666);
  });
});
