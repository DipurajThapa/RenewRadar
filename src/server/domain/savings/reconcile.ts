/**
 * A2 — pure helpers for projected→realized savings reconciliation. No DB, no
 * clock, no randomness, so the math is fully unit-testable and deterministic.
 */

const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/**
 * The date by which the renewed price should be observable in the spend feed:
 * the term end plus one billing cycle (the first post-renewal charge). The
 * reconciliation cron only acts on records once this date has passed. Pure UTC
 * date math — unknown cycles fall back to a full year (the conservative wait).
 */
export function expectedRealizationDate(
  termEndDateIso: string,
  billingCycle: string
): Date {
  const months = CYCLE_MONTHS[billingCycle] ?? 12;
  const [y, m, d] = termEndDateIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + months, d!));
}

export type ReconciliationStatus = "realized" | "variance" | "not_observed";

/**
 * Did the realized saving match the projection? Within tolerance → "realized";
 * otherwise "variance" (the negotiated price didn't stick, or stuck better than
 * promised). Tolerance = max(5% of the baseline, $50) so tiny rounding deltas
 * don't read as a variance. Pure.
 */
export function classifyReconciliation(input: {
  baselineAnnualUsdCents: number;
  projectedSavedAnnualUsdCents: number;
  realizedSavedAnnualUsdCents: number;
}): "realized" | "variance" {
  const tolerance = Math.max(
    Math.round(input.baselineAnnualUsdCents * 0.05),
    5_000 // $50
  );
  const delta = Math.abs(
    input.realizedSavedAnnualUsdCents - input.projectedSavedAnnualUsdCents
  );
  return delta <= tolerance ? "realized" : "variance";
}
