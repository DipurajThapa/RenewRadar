/**
 * Cross-account benchmark uplift (Phase 5, D3) — `pnpm ai:uplift`.
 *
 * Proves the cross-account benchmark MEASURABLY sharpens recommendations: a
 * recommender WITH the peer benchmark beats one WITHOUT it on "are you overpaying?"
 * across market segments. Deterministic simulation (real customer data excluded by
 * design); the same machinery runs on real cross-account medians once tenants
 * accumulate (k-anon N≥3 already enforced in production).
 */
import {
  simulateBenchmarkUplift,
  simulateExemplarUplift,
} from "@server/infrastructure/ai/eval/uplift";

const seed = Number(process.env.UPLIFT_SEED ?? 20260601);
const n = Number(process.env.UPLIFT_N ?? 600);

const r = simulateBenchmarkUplift(seed, n);
console.log("\n──────── CROSS-ACCOUNT BENCHMARK UPLIFT (D3) ────────");
console.log(`accounts                                   ${r.n}`);
console.log(`recommendation accuracy WITHOUT benchmark  ${r.withoutBenchmarkAccuracyPct}%`);
console.log(`recommendation accuracy WITH benchmark     ${r.withBenchmarkAccuracyPct}%`);
console.log(`uplift                                     +${r.upliftPct} pts`);

const e = simulateExemplarUplift(seed, n);
console.log("\n──────── FEW-SHOT EXEMPLAR-MINING UPLIFT (D1) ────────");
console.log(`documents                                  ${e.n}`);
console.log(`extraction accuracy WITHOUT exemplars      ${e.withoutExemplarsAccuracyPct}%`);
console.log(`extraction accuracy WITH exemplars         ${e.withExemplarsAccuracyPct}%`);
console.log(`uplift                                     +${e.upliftPct} pts`);

const pass =
  r.upliftPct > 0 &&
  r.withBenchmarkAccuracyPct > r.withoutBenchmarkAccuracyPct &&
  e.upliftPct > 0 &&
  e.withExemplarsAccuracyPct > e.withoutExemplarsAccuracyPct;
console.log(
  `\nMOAT VERDICT: ${pass ? "PASS ✅ — both moat axes (benchmark + exemplars) sharpen the AI" : "REVIEW ⚠️"}`
);

if (!pass) process.exit(2);
