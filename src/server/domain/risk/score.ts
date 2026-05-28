/**
 * Risk scoring for renewal events.
 *
 * Pure function. No DB, no I/O. Recomputed on demand at read time — we never
 * persist the score (it would go stale the day after).
 *
 * The score is a 0–100 blend of three signals:
 *
 *   1. Urgency (0–60): how close are we to the notice deadline?
 *        days ≤ 0    → 60   (already past — maximum urgency)
 *        days ≤ 1    → 55
 *        days ≤ 3    → 55
 *        days ≤ 7    → 50
 *        days ≤ 14   → 30
 *        days ≤ 30   → 20
 *        days ≤ 60   → 8
 *        days ≤ 90   → 3
 *        else        → 0
 *
 *   2. Value (0–25): annualized $ at stake, on a log-ish scale.
 *        ≤ $1K  → 5
 *        ≤ $5K  → 10
 *        ≤ $25K → 15
 *        ≤ $100K → 20
 *        > $100K → 25
 *
 *   3. Clause pressure (0–15): boolean flags that mean "this won't fix itself".
 *        auto_renew = true → +10
 *        deadline already missed → +5
 *
 * The wedge invariant:
 *
 *   ANY auto-renewing renewal whose notice deadline is within 7 days lands
 *   high-band, regardless of contract size. Math:
 *     50 (urgency) + 5 (smallest value tier) + 10 (auto-renew) = 65 ≥ 60.
 *
 *   A non-auto-renewing renewal in the same window lands medium: 55 < 60.
 *   That's intentional — manual-renewing customers have already decided to
 *   pay attention, so they don't need the same red flag.
 *
 * Beyond 30 days, urgency drops fast and value/clauses dominate. A $100K
 * auto-renewing contract 90 days out lands at 3 + 20 + 10 = 33 (low) — it
 * deserves attention, but not in the action queue this week.
 */
export type RiskBand = "low" | "medium" | "high";

export type RiskInput = {
  /** Days until notice deadline. Negative if already passed. */
  daysUntilNoticeDeadline: number;
  /** Annualized contract value in CENTS. */
  annualValueCents: number;
  autoRenew: boolean;
  /** True iff the renewal_event.status is "missed". */
  isMissed: boolean;
};

export type RiskResult = {
  score: number; // 0-100
  band: RiskBand;
  components: {
    urgency: number;
    value: number;
    clausePressure: number;
  };
};

export function scoreRisk(input: RiskInput): RiskResult {
  const urgency = urgencyComponent(input.daysUntilNoticeDeadline);
  const value = valueComponent(input.annualValueCents);
  const clausePressure = clausePressureComponent(input);

  const score = clamp(urgency + value + clausePressure, 0, 100);
  return {
    score,
    band: bandForScore(score),
    components: { urgency, value, clausePressure },
  };
}

export function bandForScore(score: number): RiskBand {
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

// ─── components ──────────────────────────────────────────────────────────────

function urgencyComponent(days: number): number {
  if (days <= 0) return 60;
  if (days <= 1) return 55;
  if (days <= 3) return 55;
  if (days <= 7) return 50;
  if (days <= 14) return 30;
  if (days <= 30) return 20;
  if (days <= 60) return 8;
  if (days <= 90) return 3;
  return 0;
}

function valueComponent(annualCents: number): number {
  const dollars = annualCents / 100;
  if (dollars <= 1_000) return 5;
  if (dollars <= 5_000) return 10;
  if (dollars <= 25_000) return 15;
  if (dollars <= 100_000) return 20;
  return 25;
}

function clausePressureComponent(input: RiskInput): number {
  let total = 0;
  if (input.autoRenew) total += 10;
  if (input.isMissed) total += 5;
  return total;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
