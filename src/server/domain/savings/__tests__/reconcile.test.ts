/**
 * A2 — pure reconciliation helpers.
 */
import { describe, expect, it } from "vitest";
import {
  classifyReconciliation,
  expectedRealizationDate,
} from "@server/domain/savings/reconcile";

describe("expectedRealizationDate", () => {
  it("adds one billing cycle to the term end (UTC)", () => {
    expect(expectedRealizationDate("2026-06-30", "monthly").toISOString()).toBe(
      "2026-07-30T00:00:00.000Z"
    );
    expect(expectedRealizationDate("2026-06-30", "quarterly").toISOString()).toBe(
      "2026-09-30T00:00:00.000Z"
    );
    expect(expectedRealizationDate("2026-06-30", "annual").toISOString()).toBe(
      "2027-06-30T00:00:00.000Z"
    );
  });

  it("falls back to a full year for unknown cycles (conservative)", () => {
    expect(expectedRealizationDate("2026-01-15", "weird").toISOString()).toBe(
      "2027-01-15T00:00:00.000Z"
    );
  });
});

describe("classifyReconciliation", () => {
  it("returns realized when within tolerance (5% of baseline or $50)", () => {
    expect(
      classifyReconciliation({
        baselineAnnualUsdCents: 1_000_000, // $10k → 5% = $500 tolerance
        projectedSavedAnnualUsdCents: 200_000,
        realizedSavedAnnualUsdCents: 195_000, // $50 under
      })
    ).toBe("realized");
  });

  it("returns variance when beyond tolerance", () => {
    expect(
      classifyReconciliation({
        baselineAnnualUsdCents: 1_000_000,
        projectedSavedAnnualUsdCents: 200_000,
        realizedSavedAnnualUsdCents: 120_000, // $800 under → > $500 tolerance
      })
    ).toBe("variance");
  });

  it("uses the $50 floor when 5% of baseline is tiny", () => {
    // baseline $200 → 5% = $10, but floor is $50.
    expect(
      classifyReconciliation({
        baselineAnnualUsdCents: 20_000,
        projectedSavedAnnualUsdCents: 10_000,
        realizedSavedAnnualUsdCents: 6_000, // $40 under → within $50 floor
      })
    ).toBe("realized");
  });
});
