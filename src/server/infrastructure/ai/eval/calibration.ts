/**
 * Confidence calibration (Phase 5, D1) — the moat machinery.
 *
 * Raw model confidence is often mis-calibrated (the eval found qwen "overconfident
 * when wrong"). Given LABELED outcomes — which the product already collects every
 * time a human accepts/edits/rejects an AI value (see application/ai-feedback) — we
 * can FIT a calibration map that turns raw confidence into honest confidence. The
 * more correction data accumulates, the better the map: this is the asset that
 * compounds with usage and that a competitor without usage data cannot copy.
 *
 * Pure + deterministic + unit-tested. `scripts/ai-eval/compounding.ts` proves in
 * simulation that more correction rounds monotonically reduce calibration error.
 */
import type { ConfidencePoint } from "./types";

export type CalibrationMap = {
  bins: number;
  /** Calibrated confidence (0..100) for each raw-confidence bin. */
  calibrated: number[];
  /** Labeled-sample count per bin (a thin bin is less trustworthy). */
  counts: number[];
};

/**
 * Fit a binned calibration map: each raw-confidence bin maps to the EMPIRICAL
 * accuracy observed in that bin. Bins with no data fall back to identity (the bin
 * midpoint), so the map never invents calibration it hasn't seen.
 */
export function fitCalibration(points: ConfidencePoint[], bins = 10): CalibrationMap {
  const width = 100 / bins;
  const calibrated: number[] = [];
  const counts: number[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b * width;
    const hi = b === bins - 1 ? 100.0001 : (b + 1) * width;
    const inBin = points.filter((p) => p.confidencePct >= lo && p.confidencePct < hi);
    counts.push(inBin.length);
    if (inBin.length === 0) {
      calibrated.push(Math.round(lo + width / 2)); // identity fallback
    } else {
      const acc = inBin.filter((p) => p.correct).length / inBin.length;
      calibrated.push(Math.round(acc * 100));
    }
  }
  return { bins, calibrated, counts };
}

/** Map a raw confidence through the fitted calibration map. */
export function applyCalibration(map: CalibrationMap, rawPct: number): number {
  const width = 100 / map.bins;
  const clamped = Math.max(0, Math.min(100, rawPct));
  let b = Math.floor(clamped / width);
  if (b >= map.bins) b = map.bins - 1;
  return Math.max(0, Math.min(100, Math.round(map.calibrated[b]!)));
}

/** Re-map a set of points' confidences through a calibration map (for ECE eval). */
export function calibratePoints(
  map: CalibrationMap,
  points: ConfidencePoint[]
): ConfidencePoint[] {
  return points.map((p) => ({
    confidencePct: applyCalibration(map, p.confidencePct),
    correct: p.correct,
  }));
}
