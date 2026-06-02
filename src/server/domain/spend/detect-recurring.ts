/**
 * Wedge PoC — recurring-charge detection. PURE + deterministic (no DB, no
 * clock, no randomness) so it's fully unit-testable and its output is stable.
 *
 * This is the IP behind "the human stops being the data pipe": a stream of
 * card/expense lines becomes a small set of high-confidence subscription
 * SUGGESTIONS, with one-off purchases rejected. It never mutates anything —
 * reconciliation (human-confirmed) is a separate step.
 *
 * Pipeline per (normalizedMerchant, currency) group:
 *   0. Net refunds — a charge fully reversed by a later credit is removed.
 *   1. Amount-plateau cluster — split a merchant's charges into amount bands
 *      (gap-based) so a steady $40/mo stream survives among chaotic one-offs,
 *      while a clean price step (150→172) stays one cluster.
 *   2. Classify cadence from the MEDIAN inter-charge interval (robust to a
 *      skipped month) → monthly / quarterly / annual, or reject.
 *   3. Single big SaaS charge with no interval evidence → annual suggestion
 *      flagged needsManualConfirm (never auto-projected).
 *   4. Confidence (0–100), drift %, projected next charge.
 *
 * Bias toward SILENCE: a missed recurring charge is invisible; a false one in
 * front of finance is a credibility-ender. Reject thresholds are conservative.
 */

export type DetectorTransaction = {
  normalizedMerchant: string;
  currency: string;
  /** Integer cents, signed (negative = refund/credit). */
  amountCents: number;
  /** YYYY-MM-DD. */
  chargedOn: string;
  mcc: string | null;
};

export type DetectedCycle = "monthly" | "quarterly" | "annual";

export type RecurringChargeCandidate = {
  normalizedMerchant: string;
  currency: string;
  suggestedVendorName: string;
  detectedCycle: DetectedCycle;
  typicalAmountCents: number;
  latestAmountCents: number;
  amountDriftPct: number;
  confidence: number; // 0..100 integer
  sampleSize: number;
  needsManualConfirm: boolean;
  firstChargedOn: string;
  lastChargedOn: string;
  projectedNextChargeOn: string | null;
};

// ── tunables ────────────────────────────────────────────────────────────────
export const MIN_DETECTION_CONFIDENCE = 50;
const SINGLE_CHARGE_THRESHOLD_CENTS = 500_000; // $5,000 — annual single-charge floor
const AMOUNT_PLATEAU_GAP = 0.15; // >15% jump between sorted amounts → new cluster
const REFUND_MATCH_DAYS = 35;
const REFUND_MATCH_BAND = 0.15;
const SAAS_MCCS = new Set(["5734", "7372", "5817", "5818"]);

import { suggestedVendorNameFromKey } from "./normalize";

// ── small pure helpers ───────────────────────────────────────────────────────
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay!, am! - 1, ad!);
  const db = Date.UTC(by!, bm! - 1, bd!);
  return Math.round((db - da) / 86_400_000);
}
function addDaysUtc(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
/** Unrounded median — used for cadence classification so an even-count stream
 *  like [35,36] (raw 35.5) isn't pushed across the monthly boundary by integer
 *  rounding (EDGE-3). The rounded `median` stays for amount math. */
function medianRaw(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function classifyCadence(medianDays: number): DetectedCycle | null {
  // Monthly upper bound is 37 (not 35): a calendar month is up to 31 days and a
  // charge posted a few days late still reads monthly. Quarterly starts at 82,
  // so there's no overlap (EDGE-3). Compared against the UNROUNDED median.
  if (medianDays >= 26 && medianDays <= 37) return "monthly";
  if (medianDays >= 82 && medianDays <= 100) return "quarterly";
  if (medianDays >= 330 && medianDays <= 400) return "annual";
  return null; // irregular / semi-annual / bi-monthly → not auto-detected
}

/** Number of sign flips in the consecutive-amount-delta signal — high = wobble,
 *  low (0–1) = a clean monotonic price step. Used to avoid penalizing a real
 *  price increase as if it were noise. */
function directionChanges(amountsByDate: number[]): number {
  let prevSign = 0;
  let changes = 0;
  for (let i = 1; i < amountsByDate.length; i++) {
    const d = amountsByDate[i]! - amountsByDate[i - 1]!;
    if (d === 0) continue;
    const sign = d > 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) changes++;
    prevSign = sign;
  }
  return changes;
}

// ── refund netting ───────────────────────────────────────────────────────────
function isCadenceGap(gap: number): boolean {
  return (
    (gap >= 26 && gap <= 37) ||
    (gap >= 82 && gap <= 100) ||
    (gap >= 330 && gap <= 400)
  );
}

function netRefunds(group: DetectorTransaction[]): DetectorTransaction[] {
  const positives = group.filter((t) => t.amountCents > 0);
  const negatives = group.filter((t) => t.amountCents < 0);
  if (negatives.length === 0) return positives;

  // For each positive, how many OTHER positives sit a recurring interval away.
  // A true one-off scores 0; a member of a steady stream scores ≥1. We use this
  // to protect recurring members from being consumed by a refund that should
  // match a same-amount one-off (EDGE-5).
  const cadenceScore = positives.map((p, i) =>
    positives.reduce((acc, q, j) => {
      if (i === j) return acc;
      return acc + (isCadenceGap(Math.abs(daysBetween(p.chargedOn, q.chargedOn))) ? 1 : 0);
    }, 0)
  );

  const used = new Set<number>();
  for (const neg of negatives) {
    const target = Math.abs(neg.amountCents);
    let bestIdx = -1;
    // Rank key (lower is better): [amountDelta, cadenceScore, dayGap] — net the
    // closest-amount match first; among ties prefer the one-off over a stream
    // member; then the nearest date.
    let bestKey: [number, number, number] | null = null;
    positives.forEach((pos, idx) => {
      if (used.has(idx)) return;
      const amountDelta = Math.abs(pos.amountCents - target);
      const within = amountDelta <= target * REFUND_MATCH_BAND;
      const dayGap = daysBetween(pos.chargedOn, neg.chargedOn);
      if (!within || dayGap < 0 || dayGap > REFUND_MATCH_DAYS) return;
      const key: [number, number, number] = [amountDelta, cadenceScore[idx]!, dayGap];
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] &&
          (key[1] < bestKey[1] ||
            (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        bestKey = key;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
  }
  return positives.filter((_, idx) => !used.has(idx));
}

// ── amount-plateau clustering (gap-based, deterministic) ──────────────────────
function clusterByAmount(charges: DetectorTransaction[]): DetectorTransaction[][] {
  const byAmount = [...charges].sort((a, b) => a.amountCents - b.amountCents);
  const clusters: DetectorTransaction[][] = [];
  let current: DetectorTransaction[] = [];
  for (const c of byAmount) {
    if (current.length === 0) {
      current.push(c);
      continue;
    }
    const prev = current[current.length - 1]!.amountCents;
    const ratio = prev > 0 ? c.amountCents / prev : Infinity;
    if (ratio > 1 + AMOUNT_PLATEAU_GAP) {
      clusters.push(current);
      current = [c];
    } else {
      current.push(c);
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}

// ── classify one amount cluster into a candidate (or null) ────────────────────
function classifyCluster(
  cluster: DetectorTransaction[]
): RecurringChargeCandidate | null {
  const byDate = [...cluster].sort((a, b) =>
    a.chargedOn < b.chargedOn ? -1 : a.chargedOn > b.chargedOn ? 1 : 0
  );
  const amountsByDate = byDate.map((t) => t.amountCents);
  const merchant = byDate[0]!.normalizedMerchant;
  const currency = byDate[0]!.currency;
  const mcc = byDate.find((t) => t.mcc)?.mcc ?? null;
  const isSaas = mcc ? SAAS_MCCS.has(mcc) : false;
  const first = byDate[0]!;
  const last = byDate[byDate.length - 1]!;
  const suggestedVendorName = suggestedVendorNameFromKey(merchant);

  if (byDate.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < byDate.length; i++) {
      deltas.push(daysBetween(byDate[i - 1]!.chargedOn, byDate[i]!.chargedOn));
    }
    const medInterval = medianRaw(deltas);
    const cycle = classifyCadence(medInterval);
    if (!cycle) return null; // irregular → not recurring

    const intervalCV = medInterval > 0 ? stddev(deltas) / medInterval : 1;
    if (intervalCV > 0.5) return null; // too irregular to trust

    const typical = median(amountsByDate);
    const latest = last.amountCents;
    // Drift as a TREND (first-third median vs last-third median), not a raw
    // endpoint comparison. Endpoint comparison reported phantom drift on flat
    // subscriptions whose amounts wobbled with usage noise — e.g. Datadog at
    // $7,000 ± 8% returned +8% "price increase" from pure noise. A trend over
    // smoothed thirds neutralizes wobble while still catching a real step
    // (Slack's $150 → $172 mid-stream step still reads ≈ +15%).
    const k = Math.max(1, Math.floor(byDate.length / 3));
    const firstThirdMed = median(amountsByDate.slice(0, k));
    const lastThirdMed = median(amountsByDate.slice(-k));
    const driftPct =
      firstThirdMed > 0
        ? Math.round(((lastThirdMed - firstThirdMed) / firstThirdMed) * 100)
        : 0;

    // Wobble penalty only when the amounts oscillate (≥2 direction changes);
    // a clean monotonic step (price increase) is not penalized as noise.
    const amountCV =
      mean(amountsByDate) > 0 ? stddev(amountsByDate) / mean(amountsByDate) : 0;
    const wobble = directionChanges(amountsByDate) >= 2 ? amountCV : 0;

    let conf = 55;
    conf += Math.min(byDate.length - 1, 6) * 5; // +5/extra sample, cap +30
    conf -= Math.round(intervalCV * 100);
    conf -= Math.round(wobble * 100);
    if (isSaas) conf += 10;
    const confidence = clampInt(conf, 0, 100);

    return {
      normalizedMerchant: merchant,
      currency,
      suggestedVendorName,
      detectedCycle: cycle,
      typicalAmountCents: typical,
      latestAmountCents: latest,
      amountDriftPct: driftPct,
      confidence,
      sampleSize: byDate.length,
      needsManualConfirm: false,
      firstChargedOn: first.chargedOn,
      lastChargedOn: last.chargedOn,
      projectedNextChargeOn: addDaysUtc(last.chargedOn, Math.round(medInterval)),
    };
  }

  // sampleSize === 1: no interval evidence. Only a large SaaS charge is worth
  // surfacing — as an annual suggestion the human must confirm.
  if (first.amountCents >= SINGLE_CHARGE_THRESHOLD_CENTS && isSaas) {
    return {
      normalizedMerchant: merchant,
      currency,
      suggestedVendorName,
      detectedCycle: "annual",
      typicalAmountCents: first.amountCents,
      latestAmountCents: first.amountCents,
      amountDriftPct: 0,
      confidence: clampInt(40, 0, 100),
      sampleSize: 1,
      needsManualConfirm: true,
      firstChargedOn: first.chargedOn,
      lastChargedOn: first.chargedOn,
      projectedNextChargeOn: null, // never fabricate a date from one point
    };
  }
  return null;
}

/**
 * Detect recurring charges across a transaction set. Groups by
 * (normalizedMerchant, currency), nets refunds, clusters by amount, classifies
 * each cluster, and returns only candidates clearing MIN_DETECTION_CONFIDENCE.
 */
export function detectRecurringCharges(
  transactions: DetectorTransaction[]
): RecurringChargeCandidate[] {
  // group by (merchant, currency)
  const groups = new Map<string, DetectorTransaction[]>();
  for (const t of transactions) {
    const key = `${t.normalizedMerchant} ${t.currency}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const candidates: RecurringChargeCandidate[] = [];
  for (const group of groups.values()) {
    const positives = netRefunds(group);
    if (positives.length === 0) continue;
    for (const cluster of clusterByAmount(positives)) {
      const candidate = classifyCluster(cluster);
      if (candidate && candidate.confidence >= MIN_DETECTION_CONFIDENCE) {
        candidates.push(candidate);
      }
    }
  }
  // stable order: highest confidence first, then largest amount, then merchant
  candidates.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.typicalAmountCents - a.typicalAmountCents ||
      (a.normalizedMerchant < b.normalizedMerchant ? -1 : 1)
  );

  // Collapse candidates that share the persistence scope
  // (normalizedMerchant, currency, detectedCycle). clusterByAmount can split a
  // single merchant into two same-cycle amount bands (e.g. a steady $40/mo
  // stream AND a $400/mo stream); each becomes its own candidate but BOTH map
  // to the same partial-unique index on upsert, so the second would silently
  // clobber the first (EDGE-1 — data loss). Keeping the first after the sort
  // (highest confidence, then largest amount) makes the detector's output key
  // identical to the persistence key, so no collision is possible. The number
  // suppressed is returned to the caller via the difference in array length.
  const seenScopes = new Set<string>();
  const deduped: RecurringChargeCandidate[] = [];
  for (const c of candidates) {
    const scope = `${c.normalizedMerchant} ${c.currency} ${c.detectedCycle}`;
    if (seenScopes.has(scope)) continue;
    seenScopes.add(scope);
    deduped.push(c);
  }
  return deduped;
}
