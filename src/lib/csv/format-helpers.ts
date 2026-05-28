/**
 * Small shared CSV-cell formatters. The full subscription import/export uses
 * its own canonical schema in subscriptions-format.ts; this module is for the
 * ad-hoc report exports (savings, exposure, etc.) that don't round-trip.
 */

export function formatCurrencyCsv(cents: number): string {
  return (cents / 100).toFixed(2);
}
