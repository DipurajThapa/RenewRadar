/**
 * Build the "your top vendors vs typical" rows for the dashboard band.
 *
 * Pulls the account's top vendors by annualized spend, looks up the
 * cross-account benchmark for each, and returns rows where the
 * benchmark sample meets the privacy floor (the benchmark aggregator
 * returns null otherwise — we drop those).
 *
 * No caching — runs on the dashboard SSR path so it sees fresh data.
 * The query count is bounded by `LIMIT_TOP_VENDORS` * 1 benchmark
 * call per row.
 */
import {
  listVendorsWithIntelligence,
  type VendorListRow,
} from "@server/infrastructure/db/repositories/vendor-memory";
import {
  countActiveSubscriptions,
  listSubscriptions,
} from "@server/infrastructure/db/repositories/subscriptions";
import { getVendorBenchmark } from "@server/application/vendor-benchmarks";
import type { DashboardBenchmarkRow } from "@ui/features/dashboard/benchmark-band";

const LIMIT_TOP_VENDORS = 5;

export async function buildDashboardBenchmarkRows(
  accountId: string
): Promise<DashboardBenchmarkRow[]> {
  const subscriptionCount = await countActiveSubscriptions(accountId);
  if (subscriptionCount === 0) return [];

  const [vendors, subscriptions] = await Promise.all([
    listVendorsWithIntelligence(accountId),
    listSubscriptions(accountId),
  ]);

  // Pick top-5 vendors by annualized spend with at least one subscription.
  const top: VendorListRow[] = vendors
    .filter((v) => v.subscriptionCount > 0)
    .sort((a, b) => b.annualizedSpendCents - a.annualizedSpendCents)
    .slice(0, LIMIT_TOP_VENDORS);

  // For each top vendor, pick a representative subscription. The list
  // is already ordered consistently by the underlying query; the first
  // match per vendor is good enough for the "your" side of the
  // benchmark comparison. Drilling into vendor detail shows the full
  // picture when the team has multiple contracts with the same vendor.
  const subsByVendor = new Map<string, (typeof subscriptions)[number]>();
  for (const sub of subscriptions) {
    if (!subsByVendor.has(sub.vendorId)) {
      subsByVendor.set(sub.vendorId, sub);
    }
  }

  // Lookup benchmarks in parallel. The aggregator returns null when the
  // privacy floor isn't met; drop those rows.
  const candidates = await Promise.all(
    top.map(async (v) => {
      const benchmark = await getVendorBenchmark(v.name).catch(() => null);
      const sub = subsByVendor.get(v.id);
      if (!benchmark || !sub) return null;
      const row: DashboardBenchmarkRow = {
        vendorName: v.name,
        yourNoticePeriodDays: sub.noticePeriodDays,
        typicalNoticePeriodDays: benchmark.typicalNoticePeriodDays,
        yourAutoRenew: sub.autoRenew,
        typicalAutoRenewRatePct: benchmark.autoRenewRatePct,
        sampleAccounts: benchmark.sampleAccounts,
      };
      return row;
    })
  );

  return candidates.filter((r): r is DashboardBenchmarkRow => r !== null);
}
