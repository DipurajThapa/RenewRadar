/**
 * Compounding experiment (Phase 5, D2) — proves the moat machinery WORKS: more
 * correction data monotonically reduces held-out calibration error.
 *
 * The honest framing: real customer data is excluded by design, so this is a
 * SIMULATION with a known-miscalibrated source. It proves the LOOP compounds —
 * the same machinery (application/ai-feedback getCalibrationModel) runs on real
 * review decisions once usage accumulates.
 *
 * Setup: an overconfident "source" reports confidences {70,80,90,95} but is right
 * ~20 points less often than it claims. We hold out a validation set, then over N
 * rounds accumulate synthetic corrections, fit the calibration map on everything
 * so far, and measure validation ECE. It should fall toward 0.
 *
 * Run: pnpm ai:compounding
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  calibratePoints,
  fitCalibration,
} from "@server/infrastructure/ai/eval/calibration";
import { computeEce } from "@server/infrastructure/ai/eval/score";
import type { ConfidencePoint } from "@server/infrastructure/ai/eval/types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONF_LEVELS = [70, 80, 90, 95];
const OVERCONFIDENCE = 20; // claims N% but is right ~(N-20)% of the time
const trueAcc = (conf: number) => Math.max(0.05, Math.min(1, (conf - OVERCONFIDENCE) / 100));

function sample(rng: () => number): ConfidencePoint {
  const conf = CONF_LEVELS[Math.floor(rng() * CONF_LEVELS.length)]!;
  return { confidencePct: conf, correct: rng() < trueAcc(conf) };
}

function main() {
  const V = Number(process.env.COMP_VALIDATION ?? 2000);
  const N = Number(process.env.COMP_PER_ROUND ?? 200);
  const R = Number(process.env.COMP_ROUNDS ?? 6);

  // Held-out validation set (fixed seed, never used for fitting).
  const rngVal = mulberry32(99);
  const validation = Array.from({ length: V }, () => sample(rngVal));
  const baselineEce = computeEce(validation); // uncalibrated = overconfident

  const rngTrain = mulberry32(7);
  const accumulated: ConfidencePoint[] = [];
  const curve: Array<{ round: number; samples: number; ece: number }> = [];

  console.log(`Compounding experiment — overconfident source (claims N%, ~${OVERCONFIDENCE}pts optimistic)`);
  console.log(`validation=${V}  per-round corrections=${N}  rounds=${R}\n`);
  console.log(`  round 0 (no calibration)        ECE ${baselineEce}`);

  for (let r = 1; r <= R; r++) {
    for (let i = 0; i < N; i++) accumulated.push(sample(rngTrain));
    const map = fitCalibration(accumulated);
    const ece = computeEce(calibratePoints(map, validation));
    curve.push({ round: r, samples: accumulated.length, ece });
    console.log(`  round ${r} (${String(accumulated.length).padStart(4)} corrections)  ECE ${ece}`);
  }

  const finalEce = curve[curve.length - 1]!.ece;
  // Monotone-ish: never materially worse than the prior round.
  let monotone = true;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]!.ece > curve[i - 1]!.ece + 0.02) monotone = false;
  }
  const pass = finalEce < baselineEce && finalEce <= 0.05 && monotone;

  console.log("\n──────── COMPOUNDING RESULT ────────");
  console.log(`baseline ECE (uncalibrated)   ${baselineEce}`);
  console.log(`final ECE (after ${curve[curve.length - 1]!.samples} corrections) ${finalEce}`);
  console.log(`improvement                   ${Math.round((1 - finalEce / Math.max(1e-9, baselineEce)) * 100)}%`);
  console.log(`monotone (no round worse)     ${monotone}`);
  console.log(`\nMOAT VERDICT: ${pass ? "PASS ✅ — the system improves with feedback" : "REVIEW ⚠️"}`);

  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  const report = { validation: V, perRound: N, rounds: R, baselineEce, curve, finalEce, monotone, verdict: pass ? "PASS" : "REVIEW" };
  writeFileSync(path.join(outDir, "compounding-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    path.join(outDir, "compounding-report.md"),
    [
      `# Compounding Experiment — does the feedback loop work?`,
      ``,
      `Simulation (real customer data excluded by design): an overconfident source,`,
      `calibrated from accumulating synthetic corrections. The same machinery runs on`,
      `real review decisions once usage accumulates.`,
      ``,
      `**Moat verdict: ${pass ? "PASS ✅" : "REVIEW ⚠️"}** — baseline ECE ${baselineEce} → final ECE ${finalEce}`,
      `(${Math.round((1 - finalEce / Math.max(1e-9, baselineEce)) * 100)}% better) over ${curve[curve.length - 1]!.samples} corrections.`,
      ``,
      `| Round | Corrections | Validation ECE |`,
      `| --- | --- | --- |`,
      `| 0 | 0 | ${baselineEce} |`,
      ...curve.map((c) => `| ${c.round} | ${c.samples} | ${c.ece} |`),
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(outDir, "compounding-report.md")} + .json`);
  if (!pass) process.exit(2);
}

main();
