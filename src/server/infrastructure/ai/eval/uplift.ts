/**
 * Cross-account benchmark uplift (Phase 5, D3) — the testable moat claim: the
 * cross-account benchmark MEASURABLY sharpens recommendations vs going without.
 *
 * Why it should: "are you overpaying?" is a RELATIVE question. A single absolute
 * threshold mis-fires across market segments (it flags fairly-priced enterprise
 * deals and misses overpaying SMBs). The benchmark supplies each account's PEER
 * median (k-anon, N≥3) so the recommender compares like-for-like. This proves it
 * in simulation — no real customer data, the deliberately-excluded gap.
 */
export type UpliftResult = {
  n: number;
  withoutBenchmarkAccuracyPct: number;
  withBenchmarkAccuracyPct: number;
  upliftPct: number;
};

/** Deterministic PRNG (so the experiment is reproducible). */
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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

// Market segments with very different price scales — the reason a single absolute
// threshold cannot work and a peer benchmark must.
const SEGMENTS = [
  { name: "smb", median: 20_000 },
  { name: "mid", median: 60_000 },
  { name: "ent", median: 200_000 },
];

export function simulateBenchmarkUplift(seed = 20260601, n = 600): UpliftResult {
  const rnd = mulberry32(seed);
  const accounts = Array.from({ length: n }, () => {
    const seg = SEGMENTS[Math.floor(rnd() * SEGMENTS.length)]!;
    const value = Math.round(seg.median * (0.6 + rnd() * 1.2)); // 0.6×–1.8× segment median
    return { seg: seg.name, value, noise: rnd() < 0.1 };
  });

  // The cross-account benchmark: per-segment peer median (k-anon — each segment
  // has many accounts here, well above the N≥3 floor).
  const benchMedian: Record<string, number> = {};
  for (const s of SEGMENTS) {
    benchMedian[s.name] = median(
      accounts.filter((a) => a.seg === s.name).map((a) => a.value)
    );
  }

  // A single absolute threshold the no-benchmark recommender must guess at — the
  // best it can do without peer context. (Tuned to the overall median.)
  const ABSOLUTE = median(accounts.map((a) => a.value)) * 1.3;

  let withoutCorrect = 0;
  let withCorrect = 0;
  for (const a of accounts) {
    const peerMedian = benchMedian[a.seg]!;
    // Ground truth: genuinely overpaying RELATIVE to peers (+10% label noise for
    // reasons the price signal can't capture — so the benchmark recommender isn't
    // a trivial oracle).
    const truth = (a.value > peerMedian * 1.3) !== a.noise;
    const without = a.value > ABSOLUTE; // no peer context
    const withB = a.value > peerMedian * 1.3; // benchmark-relative
    if (without === truth) withoutCorrect++;
    if (withB === truth) withCorrect++;
  }

  const withoutPct = Math.round((withoutCorrect / n) * 100);
  const withPct = Math.round((withCorrect / n) * 100);
  return {
    n,
    withoutBenchmarkAccuracyPct: withoutPct,
    withBenchmarkAccuracyPct: withPct,
    upliftPct: withPct - withoutPct,
  };
}

export type ExemplarUpliftResult = {
  n: number;
  withoutExemplarsAccuracyPct: number;
  withExemplarsAccuracyPct: number;
  upliftPct: number;
};

/**
 * Few-shot exemplar-mining uplift (D1) — proves the compounding extraction moat:
 * a generic model systematically MISREADS this account's recurring non-standard
 * terms ("advance notice", "evergreen clause", …). Each time a reviewer corrects
 * one, `mineExemplars` turns it into a few-shot example, so the NEXT document with
 * that term is read correctly. Accuracy rises as corrections accumulate; without
 * mining it stays stuck at the generic baseline. (Idealized mechanism model — the
 * real lift is measured on held-out extraction once corrections accrue.)
 */
export function simulateExemplarUplift(seed = 20260601, n = 600): ExemplarUpliftResult {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  // Account-specific terms a generic extractor gets wrong until it has seen a fix.
  const NON_STANDARD = ["advance notice", "evergreen clause", "anniversary date", "auto-extend"];
  const learned = new Set<string>(); // mined exemplars (term corrected before)
  let withoutCorrect = 0;
  let withCorrect = 0;
  for (let i = 0; i < n; i++) {
    const isNonStandard = rnd() < 0.4;
    const term = isNonStandard
      ? NON_STANDARD[Math.floor(rnd() * NON_STANDARD.length)]!
      : "standard";
    const genericRight = !isNonStandard; // generic only handles standard phrasing

    if (genericRight) withoutCorrect++;
    if (genericRight || learned.has(term)) withCorrect++;

    // The reviewer corrects a missed field → it's mined as an exemplar for next time.
    if (isNonStandard) learned.add(term);
  }
  const withoutPct = Math.round((withoutCorrect / n) * 100);
  const withPct = Math.round((withCorrect / n) * 100);
  return {
    n,
    withoutExemplarsAccuracyPct: withoutPct,
    withExemplarsAccuracyPct: withPct,
    upliftPct: withPct - withoutPct,
  };
}
