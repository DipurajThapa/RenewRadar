/**
 * Wedge PoC — Renewal Intelligence Brief.
 *
 * The fix for "the AI is heuristic theater": a brief that REASONS over multiple
 * composed signals (price trajectory + benchmark + urgency + leverage + BATNA)
 * into a recommendation no spreadsheet cell produces — with PER-CLAIM evidence
 * and HONEST provenance (`engine: "deterministic" | "llm"`). The default engine
 * is deterministic + offline; an Anthropic adapter is wired behind a key gate
 * and, when enabled, is held to the SAME evidence-binding validator.
 */
import type { InsightMeta } from "@server/infrastructure/ai/types";

export type ReasoningEngine = "deterministic" | "llm";

export type ChargePoint = {
  effectiveDate: string; // YYYY-MM-DD
  totalAnnualizedCents: number;
  // "spend_feed" = an actual card/expense charge from the auto-ingested spend
  // feed (the moat: the trajectory is reasoned over REAL observed charges, not
  // just contract events).
  source: "subscription_created" | "price_changed" | "term_start" | "spend_feed";
  refId: string | null; // vendor_event / spend_transaction id when available
};

export type RenewalBriefInput = {
  accountId: string;
  subscriptionId: string;
  vendorName: string;
  productName: string;
  billingCycle: string;
  annualValueCents: number;
  autoRenew: boolean;
  noticePeriodDays: number;
  termEndDate: string;
  /** Precomputed by the aggregator so the provider has no clock dependency. */
  daysUntilNoticeDeadline: number;
  noticeDeadlineMissed: boolean;
  hasPriceIncreaseClause: boolean;
  priceIncreaseClauseText: string | null;
  /** oldest → newest. */
  chargeHistory: ChargePoint[];
  benchmark: {
    /** Includes the calling account — copy must say "including yours". */
    sampleAccounts: number;
    typicalNoticePeriodDays: number | null;
    autoRenewRatePct: number | null;
    medianAnnualValueCents: number | null;
    topLevers: Array<{ lever: string; count: number }>;
    medianSavingsAnnualCents: number | null;
  } | null;
  priorDecisions: Array<{
    decision: string;
    negotiationLever: string | null;
    savedAnnualUsdCents: number | null;
    decidedAt: string | null;
  }>;
};

export type BriefEvidence = {
  source:
    | "charge_history"
    | "benchmark"
    | "notice_deadline"
    | "auto_renew_flag"
    | "price_increase_clause"
    | "prior_decision";
  detail: string;
  /** Verbatim quote when the source is a clause; else null. */
  quote: string | null;
  refId: string | null;
};

export type BriefClaimKey =
  | "price_trajectory"
  | "benchmark_position"
  | "renewal_risk"
  | "leverage"
  | "batna"
  | "recommended_action";

export type BriefClaim = {
  key: BriefClaimKey;
  statement: string;
  engine: ReasoningEngine; // honest per-claim provenance
  confidencePct: number; // integer 0..100
  evidence: BriefEvidence[]; // empty array forbidden for emitted claims
};

export type RecommendedAction =
  | "renewed"
  | "renewed_with_adjustments"
  | "downgraded"
  | "cancelled"
  | "deferred";

export type RenewalIntelligenceBrief = {
  meta: InsightMeta & { engine: ReasoningEngine; briefVersion: string };
  headline: string; // ≤ 140 chars
  recommendedAction: RecommendedAction;
  claims: BriefClaim[];
  /** null when < 2 charge points (don't fabricate a prediction). */
  predictedNextAnnualCents: { point: number; low: number; high: number } | null;
};

export interface ReasoningProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  buildBrief(input: RenewalBriefInput): Promise<RenewalIntelligenceBrief>;
}
