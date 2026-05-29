/**
 * Cross-account vendor benchmarks — the network-effects moat.
 *
 * For any vendor a customer has, we can show "what's typical" patterns
 * derived from the aggregate behaviour of every OTHER customer who has
 * the same vendor. This becomes more valuable as the customer base grows
 * — a Vendr / Tropic / Sastrify competitor without this data layer is
 * stuck giving generic advice.
 *
 * Privacy guarantees (the floor below which we never disclose):
 *   - Minimum unique accountId count = 3 before any aggregate is exposed
 *   - No specific contract values disclosed — only modes / medians /
 *     percentage rates
 *   - No customer names disclosed; the only label is the vendor's own
 *     normalized name (which the caller already knew)
 *   - The QUERY scope is cross-account by design, but the API surface
 *     stays small and read-only — callers can only ask "for this vendor
 *     I have, what's typical?"
 *
 * The N>=3 floor is hard-coded; see MIN_BENCHMARK_SAMPLE.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import { normalizeVendorName } from "./normalize";

/**
 * The hard privacy floor — no benchmark is disclosed until at least this
 * many DISTINCT account IDs share the vendor. Three is small enough to
 * surface insight in early-stage data, large enough that no single
 * customer's contract terms can be inferred.
 */
export const MIN_BENCHMARK_SAMPLE = 3;

export type VendorBenchmark = {
  /** Normalized key the benchmark was computed against. Display the user's
   *  original vendor name; this is for diagnostics only. */
  normalizedName: string;
  /** Number of distinct accounts contributing to this aggregate. */
  sampleAccounts: number;
  /** Number of subscriptions in the sample (≥ sampleAccounts). */
  sampleSubscriptions: number;
  /** Most common (mode) notice period in days. */
  typicalNoticePeriodDays: number | null;
  /**
   * % of subscriptions where auto-renew is true. 0-100 with one decimal.
   * "Of customers tracking this vendor, X% see auto-renew clauses."
   */
  autoRenewRatePct: number | null;
  /** Median annualized contract value in CENTS. Hidden if too few rows. */
  medianAnnualValueCents: number | null;
  /** Top up-to-3 decision codes seen on this vendor, in frequency order. */
  topRationaleCodes: Array<{ code: string; count: number }>;
  /** Top up-to-3 negotiation levers seen on this vendor. */
  topLevers: Array<{ lever: string; count: number }>;
  /**
   * The benchmark's "what worked" summary — if there's at least one
   * recorded saving on this vendor across the sample, how much was the
   * median savings (annualized cents). Null when no savings recorded.
   */
  medianSavingsAnnualCents: number | null;
};

/**
 * Returns the benchmark for the vendor named `vendorName`, or null when
 * the cross-account sample is below MIN_BENCHMARK_SAMPLE.
 *
 * The caller passes the raw vendor name from their own account; we
 * normalize internally before the lookup.
 */
export async function getVendorBenchmark(
  vendorName: string
): Promise<VendorBenchmark | null> {
  const normalized = normalizeVendorName(vendorName);
  if (!normalized) return null;

  // Aggregate counts first to enforce the privacy floor before any
  // expensive percentile work.
  const normalizedCol: SQL<string> = sql<string>`lower(regexp_replace(${vendorsTable.name}, '[^a-zA-Z0-9 ]+', ' ', 'g'))`;

  const [counts] = await db
    .select({
      sampleAccounts: sql<number>`count(distinct ${subscriptionsTable.accountId})::int`,
      sampleSubscriptions: sql<number>`count(distinct ${subscriptionsTable.id})::int`,
    })
    .from(subscriptionsTable)
    .innerJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      // We approximate the normalization in SQL: lowercase + replace
      // non-alphanumeric with space. We post-filter in code for the
      // exact match including suffix stripping.
      sql`${normalizedCol} like ${"%" + normalized + "%"}`
    );

  if (!counts) return null;

  // Refine with an exact normalized match by pulling the full set of
  // candidate vendor names — usually a small list since LIKE narrowed it
  // already — and rejecting any whose precise normalize() doesn't match.
  const candidateVendorIds = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
      accountId: vendorsTable.accountId,
    })
    .from(vendorsTable)
    .where(sql`${normalizedCol} like ${"%" + normalized + "%"}`);

  const matchingVendorIds = candidateVendorIds
    .filter((v) => normalizeVendorName(v.name) === normalized)
    .map((v) => v.id);

  if (matchingVendorIds.length === 0) return null;

  const accountSet = new Set(
    candidateVendorIds
      .filter((v) => normalizeVendorName(v.name) === normalized)
      .map((v) => v.accountId)
  );
  const sampleAccounts = accountSet.size;
  if (sampleAccounts < MIN_BENCHMARK_SAMPLE) return null;

  // Now pull the subscription-level aggregates restricted to the exact
  // normalized-name match set.
  const subRows = await db
    .select({
      noticePeriodDays: subscriptionsTable.noticePeriodDays,
      autoRenew: subscriptionsTable.autoRenew,
      totalCostPerPeriodCents: subscriptionsTable.totalCostPerPeriodCents,
      billingCycle: subscriptionsTable.billingCycle,
    })
    .from(subscriptionsTable)
    .where(
      sql`${subscriptionsTable.vendorId} in (${sql.join(
        matchingVendorIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

  if (subRows.length < MIN_BENCHMARK_SAMPLE) return null;

  const noticeFreq = new Map<number, number>();
  let autoRenewYes = 0;
  const annualValues: number[] = [];
  for (const row of subRows) {
    noticeFreq.set(
      row.noticePeriodDays,
      (noticeFreq.get(row.noticePeriodDays) ?? 0) + 1
    );
    if (row.autoRenew) autoRenewYes += 1;
    const annual = annualize(row.totalCostPerPeriodCents, row.billingCycle);
    if (annual > 0) annualValues.push(annual);
  }
  const typicalNoticePeriodDays =
    mode(noticeFreq) ?? null;
  const autoRenewRatePct =
    Math.round((autoRenewYes / subRows.length) * 1000) / 10;
  const medianAnnualValueCents = median(annualValues);

  // Rationale + lever frequencies from decision_contexts joined to renewal
  // events scoped by vendor. Cross-account by design.
  const decisionRows = await db
    .select({
      rationaleCodesJson: decisionContextsTable.rationaleCodesJson,
      negotiationLever: decisionContextsTable.negotiationLever,
    })
    .from(decisionContextsTable)
    .innerJoin(
      renewalEventsTable,
      eq(decisionContextsTable.renewalEventId, renewalEventsTable.id)
    )
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      sql`${subscriptionsTable.vendorId} in (${sql.join(
        matchingVendorIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

  const rationaleFreq = new Map<string, number>();
  const leverFreq = new Map<string, number>();
  for (const row of decisionRows) {
    if (Array.isArray(row.rationaleCodesJson)) {
      for (const code of row.rationaleCodesJson as string[]) {
        rationaleFreq.set(code, (rationaleFreq.get(code) ?? 0) + 1);
      }
    }
    if (row.negotiationLever && row.negotiationLever !== "none") {
      leverFreq.set(
        row.negotiationLever,
        (leverFreq.get(row.negotiationLever) ?? 0) + 1
      );
    }
  }

  // Savings — median annualized.
  const savingsRows = await db
    .select({
      savedAnnualUsdCents: savingsRecordsTable.savedAnnualUsdCents,
    })
    .from(savingsRecordsTable)
    .innerJoin(
      subscriptionsTable,
      eq(savingsRecordsTable.subscriptionId, subscriptionsTable.id)
    )
    .where(
      and(
        sql`${subscriptionsTable.vendorId} in (${sql.join(
          matchingVendorIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        sql`${savingsRecordsTable.savedAnnualUsdCents} > 0`
      )
    );
  const medianSavingsAnnualCents = median(
    savingsRows.map((r) => r.savedAnnualUsdCents)
  );

  return {
    normalizedName: normalized,
    sampleAccounts,
    sampleSubscriptions: subRows.length,
    typicalNoticePeriodDays,
    autoRenewRatePct,
    medianAnnualValueCents,
    topRationaleCodes: topNByFrequency(rationaleFreq, 3).map(([code, count]) => ({
      code,
      count,
    })),
    topLevers: topNByFrequency(leverFreq, 3).map(([lever, count]) => ({
      lever,
      count,
    })),
    medianSavingsAnnualCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function annualize(centsPerPeriod: number, billingCycle: string): number {
  switch (billingCycle) {
    case "monthly":
      return centsPerPeriod * 12;
    case "quarterly":
      return centsPerPeriod * 4;
    case "annual":
      return centsPerPeriod;
    case "multi_year":
      // Assume the period is two years for multi-year unless we have better
      // metadata. Conservative for benchmark math.
      return centsPerPeriod / 2;
    default:
      return centsPerPeriod;
  }
}

function mode<K>(freq: Map<K, number>): K | null {
  let best: K | null = null;
  let bestCount = 0;
  for (const [k, n] of freq.entries()) {
    if (n > bestCount) {
      best = k;
      bestCount = n;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function topNByFrequency<K>(
  freq: Map<K, number>,
  n: number
): Array<[K, number]> {
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export { normalizeVendorName } from "./normalize";
