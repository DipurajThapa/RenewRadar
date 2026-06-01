/**
 * Account-level renewal-risk summary for the dashboard. Reuses the existing
 * action-queue rows (each already carries a per-renewal risk score) — no new
 * scorer, no new query path. Aggregates the band distribution + the single
 * biggest at-risk renewal, then narrates that top item through the existing
 * `explainRisk` insight surface (offline heuristic by default).
 *
 * Advisory only: this explains exposure and suggests where to look; it never
 * acts.
 */
import {
  listActionQueueRows,
  type ActionQueueRow,
} from "@server/infrastructure/db/repositories/action-queue";
import { scoreRisk } from "@server/domain/risk/score";
import { getInsightProvider } from "@server/infrastructure/ai";
import type { RiskExplainerOutput } from "@server/infrastructure/ai/types";

export type AccountRiskSummary = {
  total: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topAtRiskAnnualCents: number;
  topAtRisk: {
    subscriptionId: string;
    vendorName: string;
    productName: string;
    annualValueCents: number;
    band: string;
  } | null;
  /** Narrative for the single biggest risk; null when the account has none. */
  insight: RiskExplainerOutput | null;
};

const EMPTY: AccountRiskSummary = {
  total: 0,
  highCount: 0,
  mediumCount: 0,
  lowCount: 0,
  topAtRiskAnnualCents: 0,
  topAtRisk: null,
  insight: null,
};

export async function getAccountRiskSummary(
  accountId: string
): Promise<AccountRiskSummary> {
  const rows = await listActionQueueRows(accountId);
  if (rows.length === 0) return EMPTY;

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  for (const r of rows) {
    if (r.risk.band === "high") highCount++;
    else if (r.risk.band === "medium") mediumCount++;
    else lowCount++;
  }

  // The top at-risk renewal: highest risk score, ties broken by annual value.
  const top = rows.reduce((best, r) => {
    if (r.risk.score !== best.risk.score)
      return r.risk.score > best.risk.score ? r : best;
    return r.annualValueCents > best.annualValueCents ? r : best;
  }, rows[0] as ActionQueueRow);

  // Recompute the full risk breakdown for the top row (the list only carries
  // score+band) so the explainer gets its component inputs.
  const isMissed = top.status === "missed";
  const r = scoreRisk({
    daysUntilNoticeDeadline: top.daysUntilNoticeDeadline,
    annualValueCents: top.annualValueCents,
    autoRenew: top.autoRenew,
    isMissed,
  });

  let insight: RiskExplainerOutput | null = null;
  try {
    insight = await getInsightProvider().explainRisk({
      riskScore: r.score,
      riskBand: r.band,
      components: r.components,
      daysUntilNoticeDeadline: top.daysUntilNoticeDeadline,
      annualValueCents: top.annualValueCents,
      autoRenew: top.autoRenew,
      isMissed,
      vendorName: top.vendorName,
      productName: top.productName,
    });
  } catch {
    insight = null; // degrade silently — the band distribution still renders.
  }

  return {
    total: rows.length,
    highCount,
    mediumCount,
    lowCount,
    topAtRiskAnnualCents: top.annualValueCents,
    topAtRisk: {
      subscriptionId: top.subscriptionId,
      vendorName: top.vendorName,
      productName: top.productName,
      annualValueCents: top.annualValueCents,
      band: top.risk.band,
    },
    insight,
  };
}
