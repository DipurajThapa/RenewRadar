/**
 * Wedge PoC — assemble the multi-signal input for the Renewal Intelligence
 * Brief. Pure read-path (no mutation → no audit for the build itself). Threads
 * accountId into every call EXCEPT getVendorBenchmark, which is the deliberate
 * cross-account read (and whose sample INCLUDES the caller — copy says so).
 *
 * [M4] t0 anchor: createSubscriptionDraft writes NO subscription_created event,
 * so we anchor the trajectory at the subscription's termStartDate/createdAt and
 * its current annualized cost when no created-anchor event exists — never
 * assume the event is present.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  decisionContextsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { listVendorEvents } from "@server/infrastructure/db/repositories/vendor-memory";
import {
  getConfirmedChargeForSubscription,
  listPositiveTransactionsForMerchant,
} from "@server/infrastructure/db/repositories/spend";
import { getVendorBenchmark } from "@server/application/vendor-benchmarks";
import { annualizeCents } from "@server/domain/billing/annualize";
import {
  daysUntilDate,
  daysUntilNoticeDeadline,
} from "@server/domain/notice-deadline/calculate";
import type {
  ChargePoint,
  RenewalBriefInput,
} from "@server/infrastructure/ai/reasoning/types";

/**
 * How far an observed spend charge may sit from the contract's own annualized
 * cost and still be folded into the price trajectory. 6× tolerates aggressive
 * real increases / seat growth while excluding order-of-magnitude contamination
 * (a $7k platform charge folded into a $900 plan's projection). Outside the
 * band, the charge is dropped; if that leaves < 2 clean points the trajectory
 * pass suppresses the projection rather than asserting a wrong figure.
 */
const SPEND_TRAJECTORY_BAND_FACTOR = 6;

export async function buildRenewalBriefInput(
  accountId: string,
  subscriptionId: string,
  today: Date = new Date()
): Promise<RenewalBriefInput | null> {
  const detail = await getSubscriptionDetail(accountId, subscriptionId);
  if (!detail) return null;
  const { subscription: sub, vendor, renewalEvent } = detail;

  // ── charge trajectory from append-only vendor_events ──────────────────────
  const events = await listVendorEvents(accountId, vendor.id, {
    kinds: ["subscription_created", "price_changed", "seat_count_changed"],
    limit: 200,
  });
  const sorted = [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0
  );

  const chargeHistory: ChargePoint[] = [];
  // [M4] anchor t0 at termStart with the subscription's own annualized cost.
  const anchorDate = sub.termStartDate ?? sub.createdAt.toISOString().slice(0, 10);
  const anchorAnnualizedCents = annualizeCents(
    sub.totalCostPerPeriodCents,
    sub.billingCycle
  );
  chargeHistory.push({
    effectiveDate: anchorDate,
    totalAnnualizedCents: anchorAnnualizedCents,
    source: "term_start",
    refId: null,
  });
  for (const ev of sorted) {
    const p = ev.payload as Record<string, unknown>;
    if (ev.kind === "price_changed" && typeof p.afterTotalCostPerPeriodCents === "number") {
      chargeHistory.push({
        effectiveDate: ev.occurredAt.toISOString().slice(0, 10),
        totalAnnualizedCents: annualizeCents(
          p.afterTotalCostPerPeriodCents,
          sub.billingCycle
        ),
        source: "price_changed",
        refId: ev.id,
      });
    }
  }

  // ── REAL charge trajectory from the auto-ingested spend feed (the moat) ────
  // If reconcile linked a confirmed recurring charge to this subscription, fold
  // its actual per-period charges into the trajectory so the price-trajectory
  // pass regresses over OBSERVED spend, not just contract events. USD-only —
  // foreign currency can't be annualized into the USD trajectory (mirrors the
  // EDGE-2 reconcile guard).
  const confirmedCharge = await getConfirmedChargeForSubscription(
    accountId,
    subscriptionId
  );
  if (confirmedCharge && confirmedCharge.currency === "USD") {
    const txns = await listPositiveTransactionsForMerchant(
      accountId,
      confirmedCharge.connectionId,
      confirmedCharge.normalizedMerchant,
      confirmedCharge.currency
    );
    for (const t of txns) {
      const annualized = annualizeCents(t.amountCents, confirmedCharge.detectedCycle);
      // Only fold charges that plausibly belong to THIS subscription's price
      // line. A merchant feed can carry unrelated line items (e.g. a $7k
      // platform charge alongside a $900 plan); folding those would let an
      // order-of-magnitude-off value contaminate the OLS projection and produce
      // a confidently-wrong figure. Keep within a generous band of the
      // contract's own annualized cost. If the anchor is unknown (≤0) we can't
      // define a band, so keep all (pre-guard behavior).
      if (
        anchorAnnualizedCents > 0 &&
        (annualized < anchorAnnualizedCents / SPEND_TRAJECTORY_BAND_FACTOR ||
          annualized > anchorAnnualizedCents * SPEND_TRAJECTORY_BAND_FACTOR)
      ) {
        continue;
      }
      chargeHistory.push({
        effectiveDate: t.chargedOn,
        totalAnnualizedCents: annualized,
        source: "spend_feed",
        refId: t.id,
      });
    }
  }

  // oldest → newest across all sources (term_start + price_changed + spend_feed)
  chargeHistory.sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0
  );

  // ── benchmark (cross-account; includes the caller) ────────────────────────
  const bench = await getVendorBenchmark(vendor.name).catch(() => null);

  // ── prior decisions on this vendor (own history) ──────────────────────────
  const priorRows = await db
    .select({
      decision: renewalEventsTable.decision,
      decisionAt: renewalEventsTable.decisionAt,
      negotiationLever: decisionContextsTable.negotiationLever,
      savedAnnualUsdCents: savingsRecordsTable.savedAnnualUsdCents,
    })
    .from(renewalEventsTable)
    .innerJoin(
      subscriptionsTable,
      eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
    )
    .leftJoin(
      decisionContextsTable,
      eq(decisionContextsTable.renewalEventId, renewalEventsTable.id)
    )
    .leftJoin(
      savingsRecordsTable,
      eq(savingsRecordsTable.renewalEventId, renewalEventsTable.id)
    )
    .where(
      and(
        eq(renewalEventsTable.accountId, accountId),
        eq(subscriptionsTable.vendorId, vendor.id)
      )
    )
    .orderBy(asc(renewalEventsTable.decisionAt));
  const priorDecisions = priorRows
    .filter((r) => r.decision != null)
    .map((r) => ({
      decision: r.decision as string,
      negotiationLever: r.negotiationLever ?? null,
      savedAnnualUsdCents: r.savedAnnualUsdCents ?? null,
      decidedAt: r.decisionAt ? r.decisionAt.toISOString().slice(0, 10) : null,
    }));

  // ── notice urgency ────────────────────────────────────────────────────────
  // Prefer the active renewal event's authoritative deadline — the same source
  // the Needs-you queue and the action package read. A subscription's
  // termEndDate can still point at a prior cycle while an event already tracks
  // the upcoming renewal; deriving the deadline from it would report a negative
  // day count that contradicts every other surface. Fall back to the
  // term-derived calc only when no event deadline exists.
  const days = renewalEvent?.noticeDeadline
    ? daysUntilDate(renewalEvent.noticeDeadline, today)
    : daysUntilNoticeDeadline(sub.termEndDate, sub.noticePeriodDays, today);
  const noticeDeadlineMissed = renewalEvent?.status === "missed";

  return {
    accountId,
    subscriptionId,
    vendorName: vendor.name,
    productName: sub.productName,
    billingCycle: sub.billingCycle,
    annualValueCents: annualizeCents(sub.totalCostPerPeriodCents, sub.billingCycle),
    autoRenew: sub.autoRenew,
    noticePeriodDays: sub.noticePeriodDays,
    termEndDate: sub.termEndDate,
    daysUntilNoticeDeadline: days,
    noticeDeadlineMissed,
    hasPriceIncreaseClause: Boolean(sub.priceIncreaseClauseText),
    priceIncreaseClauseText: sub.priceIncreaseClauseText,
    chargeHistory,
    benchmark: bench
      ? {
          sampleAccounts: bench.sampleAccounts,
          typicalNoticePeriodDays: bench.typicalNoticePeriodDays,
          autoRenewRatePct: bench.autoRenewRatePct,
          medianAnnualValueCents: bench.medianAnnualValueCents,
          topLevers: bench.topLevers,
          medianSavingsAnnualCents: bench.medianSavingsAnnualCents,
        }
      : null,
    priorDecisions,
  };
}
