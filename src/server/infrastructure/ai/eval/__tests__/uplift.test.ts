/**
 * Cross-account benchmark uplift (D3) — the benchmark must measurably improve
 * recommendation accuracy. Deterministic, gates in CI.
 */
import { describe, expect, it } from "vitest";
import { simulateBenchmarkUplift } from "../uplift";

describe("simulateBenchmarkUplift", () => {
  it("the peer benchmark beats an absolute threshold (positive uplift)", () => {
    const r = simulateBenchmarkUplift(20260601, 600);
    expect(r.withBenchmarkAccuracyPct).toBeGreaterThan(r.withoutBenchmarkAccuracyPct);
    expect(r.upliftPct).toBeGreaterThan(0);
    // The benchmark recommender should be strong (≈ the 90% label-noise ceiling).
    expect(r.withBenchmarkAccuracyPct).toBeGreaterThanOrEqual(85);
  });

  it("is deterministic for a fixed seed", () => {
    expect(simulateBenchmarkUplift(7, 300)).toEqual(simulateBenchmarkUplift(7, 300));
  });
});
