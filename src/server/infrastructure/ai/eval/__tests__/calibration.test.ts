/**
 * Confidence calibration (D1) — fit/apply + the ECE-reduction mechanism.
 */
import { describe, expect, it } from "vitest";
import { applyCalibration, calibratePoints, fitCalibration } from "../calibration";
import { computeEce } from "../score";
import type { ConfidencePoint } from "../types";

/** n points all reporting `conf`, of which `accuracy` fraction are correct. */
function at(conf: number, n: number, accuracy: number): ConfidencePoint[] {
  const correct = Math.round(n * accuracy);
  return Array.from({ length: n }, (_, i) => ({ confidencePct: conf, correct: i < correct }));
}

describe("fitCalibration / applyCalibration", () => {
  it("maps an overconfident bin to its empirical accuracy", () => {
    const map = fitCalibration(at(90, 100, 0.7));
    expect(applyCalibration(map, 90)).toBe(70);
  });

  it("falls back to identity (bin midpoint) for bins with no data", () => {
    const map = fitCalibration([]);
    expect(applyCalibration(map, 95)).toBe(95);
    expect(applyCalibration(map, 5)).toBe(5);
  });

  it("clamps + bins out-of-range input", () => {
    const map = fitCalibration([]);
    expect(applyCalibration(map, 150)).toBe(95); // → last bin
    expect(applyCalibration(map, -10)).toBe(5); // → first bin
  });

  it("reduces calibration error (ECE) — the moat mechanism", () => {
    const pts = [...at(90, 60, 0.6), ...at(70, 40, 0.7)]; // overconfident at 90
    const before = computeEce(pts);
    const after = computeEce(calibratePoints(fitCalibration(pts), pts));
    expect(before).toBeGreaterThan(0.1);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(0.05);
  });
});
