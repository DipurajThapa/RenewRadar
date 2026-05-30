/**
 * Pure helpers for annualizing subscription costs.
 *
 * Used everywhere a per-period cost needs to be normalized to an annual figure
 * (dashboard KPIs, KPI strips, spotlight rows, calendar rows, etc.). Don't
 * inline this calculation anywhere — import from here.
 */

export type BillingCycle =
  | "monthly"
  | "quarterly"
  | "annual"
  | "multi_year"
  | "one_time";

/**
 * Convert a per-period cost in cents to an annualized cost in cents.
 *
 *   monthly → ×12
 *   quarterly → ×4
 *   annual / multi_year → ×1
 *   one_time → ×1 (a perpetual license or one-off obligation has no recurring
 *               cadence; its cost is taken at face value, not annualized)
 *
 * Note: multi_year subscriptions are intentionally treated as annual at this
 * level — splitting across years is a V1.5 concern (cost amortization).
 */
export function annualizeCents(cents: number, cycle: BillingCycle | string): number {
  switch (cycle) {
    case "monthly":
      return cents * 12;
    case "quarterly":
      return cents * 4;
    case "annual":
    case "multi_year":
    case "one_time":
    default:
      return cents;
  }
}
