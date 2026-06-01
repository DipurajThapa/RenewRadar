/**
 * Cross-account benchmark uplift (Phase 5, D3) — `pnpm ai:uplift`.
 *
 * Proves the cross-account benchmark MEASURABLY sharpens recommendations: a
 * recommender WITH the peer benchmark beats one WITHOUT it on "are you overpaying?"
 * across market segments. Deterministic simulation (real customer data excluded by
 * design); the same machinery runs on real cross-account medians once tenants
 * accumulate (k-anon N≥3 already enforced in production).
 */
import { simulateBenchmarkUplift } from "@server/infrastructure/ai/eval/uplift";

const seed = Number(process.env.UPLIFT_SEED ?? 20260601);
const n = Number(process.env.UPLIFT_N ?? 600);
const r = simulateBenchmarkUplift(seed, n);
const pass = r.upliftPct > 0 && r.withBenchmarkAccuracyPct > r.withoutBenchmarkAccuracyPct;

console.log("\n──────── BENCHMARK UPLIFT ────────");
console.log(`accounts                       ${r.n}`);
console.log(`recommendation accuracy WITHOUT benchmark  ${r.withoutBenchmarkAccuracyPct}%`);
console.log(`recommendation accuracy WITH benchmark     ${r.withBenchmarkAccuracyPct}%`);
console.log(`uplift                          +${r.upliftPct} pts`);
console.log(`\nMOAT VERDICT: ${pass ? "PASS ✅ — the cross-account benchmark sharpens recommendations" : "REVIEW ⚠️"}`);

if (!pass) process.exit(2);
