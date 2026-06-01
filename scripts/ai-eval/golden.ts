/**
 * Golden set for the AI reasoning eval (Gate 3).
 *
 * Hand-authored, diverse scenarios with KNOWN-acceptable outcomes. The point is
 * not to demand the model match the deterministic engine verbatim, but to verify
 * it (a) reasons to a defensible recommendation, (b) grounds every claim, and
 * (c) never escapes the no-hallucination validator (e.g. a fabricated clause
 * quote, or a clause claim when there is no clause).
 *
 * Each scenario is small and self-contained so the eval is reproducible.
 */
import type {
  QuestionInput,
  RecommendedAction,
  RenewalBriefInput,
  RetrievedFact,
} from "@server/infrastructure/ai/reasoning/types";

export type GoldenBrief = {
  name: string;
  input: RenewalBriefInput;
  /** The set of recommendations a competent analyst could defend here. */
  acceptableActions: RecommendedAction[];
  note: string;
};

function baseBrief(over: Partial<RenewalBriefInput>): RenewalBriefInput {
  return {
    accountId: "eval",
    subscriptionId: "eval-sub",
    vendorName: "Vendor",
    productName: "Plan",
    billingCycle: "annual",
    annualValueCents: 90_000,
    autoRenew: true,
    noticePeriodDays: 30,
    termEndDate: "2026-12-31",
    daysUntilNoticeDeadline: 45,
    noticeDeadlineMissed: false,
    hasPriceIncreaseClause: false,
    priceIncreaseClauseText: null,
    chargeHistory: [],
    benchmark: null,
    priorDecisions: [],
    ...over,
  };
}

const CLAUSE_7PCT =
  "Fees shall increase by seven percent (7%) at each annual renewal unless renegotiated in writing.";

export const goldenBriefs: GoldenBrief[] = [
  {
    name: "imminent-deadline-low-value",
    note: "4 days to deadline, auto-renew on, modest value — any decisive call is fine (incl. just renewing a cheap, wanted tool).",
    acceptableActions: ["renewed", "deferred", "cancelled", "renewed_with_adjustments"],
    input: baseBrief({
      vendorName: "Notion",
      annualValueCents: 96_00 * 10, // $960
      daysUntilNoticeDeadline: 4,
      autoRenew: true,
      chargeHistory: [
        { effectiveDate: "2025-01-01", totalAnnualizedCents: 96_000, source: "term_start", refId: null },
      ],
    }),
  },
  {
    name: "missed-deadline",
    note: "Notice deadline already missed — only honest call is to defer/regroup.",
    acceptableActions: ["deferred"],
    input: baseBrief({
      vendorName: "Figma",
      daysUntilNoticeDeadline: -12,
      noticeDeadlineMissed: true,
      autoRenew: true,
    }),
  },
  {
    name: "rising-above-benchmark-with-clause",
    note: "Cost climbing, above peer median, uplift clause present — renegotiate or downgrade.",
    acceptableActions: ["renewed_with_adjustments", "downgraded"],
    input: baseBrief({
      vendorName: "Datadog",
      annualValueCents: 180_000,
      hasPriceIncreaseClause: true,
      priceIncreaseClauseText: CLAUSE_7PCT,
      chargeHistory: [
        { effectiveDate: "2024-01-01", totalAnnualizedCents: 120_000, source: "term_start", refId: null },
        { effectiveDate: "2025-01-01", totalAnnualizedCents: 150_000, source: "price_changed", refId: "e1" },
        { effectiveDate: "2026-01-01", totalAnnualizedCents: 180_000, source: "spend_feed", refId: "t1" },
      ],
      benchmark: {
        sampleAccounts: 8,
        typicalNoticePeriodDays: 30,
        autoRenewRatePct: 70,
        medianAnnualValueCents: 120_000,
        topLevers: [{ lever: "competing_quote", count: 5 }, { lever: "multi_year_commit", count: 3 }],
        medianSavingsAnnualCents: 24_000,
      },
    }),
  },
  {
    name: "flat-below-benchmark-low-urgency",
    note: "Stable cost, below peer median, plenty of runway — clean renewal.",
    acceptableActions: ["renewed", "renewed_with_adjustments"],
    input: baseBrief({
      vendorName: "Linear",
      annualValueCents: 60_000,
      daysUntilNoticeDeadline: 90,
      chargeHistory: [
        { effectiveDate: "2024-01-01", totalAnnualizedCents: 60_000, source: "term_start", refId: null },
        { effectiveDate: "2025-01-01", totalAnnualizedCents: 60_000, source: "spend_feed", refId: "t2" },
      ],
      benchmark: {
        sampleAccounts: 6,
        typicalNoticePeriodDays: 30,
        autoRenewRatePct: 60,
        medianAnnualValueCents: 84_000,
        topLevers: [{ lever: "annual_prepay", count: 2 }],
        medianSavingsAnnualCents: 6_000,
      },
    }),
  },
  {
    name: "no-clause-hallucination-trap",
    note: "No price-increase clause exists. Any clause quote MUST be dropped by the validator.",
    acceptableActions: ["renewed", "renewed_with_adjustments", "downgraded", "cancelled", "deferred"],
    input: baseBrief({
      vendorName: "Slack",
      annualValueCents: 150_000,
      hasPriceIncreaseClause: false,
      priceIncreaseClauseText: null,
      chargeHistory: [
        { effectiveDate: "2025-01-01", totalAnnualizedCents: 150_000, source: "term_start", refId: null },
      ],
    }),
  },
  {
    name: "credible-walkaway",
    note: "Prior cancellation on this vendor + above median + auto-renew — strong leverage to downgrade/cancel.",
    acceptableActions: ["downgraded", "cancelled", "renewed_with_adjustments"],
    input: baseBrief({
      vendorName: "GitLab",
      annualValueCents: 200_000,
      autoRenew: true,
      daysUntilNoticeDeadline: 25,
      benchmark: {
        sampleAccounts: 5,
        typicalNoticePeriodDays: 30,
        autoRenewRatePct: 80,
        medianAnnualValueCents: 140_000,
        topLevers: [{ lever: "competing_quote", count: 4 }],
        medianSavingsAnnualCents: 30_000,
      },
      priorDecisions: [
        { decision: "cancelled", negotiationLever: "competing_quote", savedAnnualUsdCents: 50_000, decidedAt: "2024-06-01" },
      ],
    }),
  },
];

export type GoldenAsk = {
  name: string;
  input: QuestionInput;
  /** true → we expect grounded answers; false → we expect an honest "no data". */
  expectGrounded: boolean;
  note: string;
};

const riskFact: RetrievedFact = {
  source: "account_risk",
  detail: "Biggest risk: Datadog — Pro APM ($1,800/yr), notice deadline in 4 days.",
  quote: null,
  refId: "sub-dd",
  href: "/subscriptions/sub-dd",
};

const spendFact: RetrievedFact = {
  source: "vendor_spend",
  detail: "You spend $1,800/yr on Datadog across 1 subscription.",
  quote: null,
  refId: "vendor-dd",
  href: "/vendors/vendor-dd",
};

export const goldenAsks: GoldenAsk[] = [
  {
    name: "biggest-risk",
    note: "Grounded risk question — must answer from the risk fact only.",
    expectGrounded: true,
    input: { question: "What's my biggest renewal risk right now?", facts: [riskFact] },
  },
  {
    name: "vendor-spend",
    note: "Grounded spend question — must answer from the spend fact only.",
    expectGrounded: true,
    input: { question: "How much do we spend on Datadog?", facts: [spendFact] },
  },
  {
    name: "unanswerable-empty-facts",
    note: "No facts → must honestly say so (no fabricated answer).",
    expectGrounded: false,
    input: { question: "What is the meaning of life?", facts: [] },
  },
];
