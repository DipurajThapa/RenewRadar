/**
 * AI provider interfaces.
 *
 * Two surfaces:
 *
 *   1. ExtractionProvider — structured field extraction from contract text.
 *      Pluggable. Heuristic stub in dev, Claude Sonnet 4.6 in prod.
 *
 *   2. AIInsightProvider — narrative insights generated on top of structured
 *      data the product already owns (risk score, vendor history, savings
 *      ledger). Heuristic stubs return deterministic templates so dev/tests
 *      see consistent output; the production swap is to Anthropic.
 *
 * Binding principle 4: every field returned by ExtractionProvider MUST carry
 * `evidenceQuote` + (when the source supports it) `evidencePageNumber`.
 * Fields missing evidence are rejected in `application/documents/extract.ts`
 * — they never reach the database. Insight providers are not bound by the
 * evidence rule (insights are synthesis, not extraction) but they MUST
 * declare a confidence score so the UI can label low-confidence narratives.
 */
import type { AiFieldKey } from "@server/infrastructure/db/schema";

// ─── Extraction ─────────────────────────────────────────────────────────────

export type ExtractionInput = {
  /** Plain text of the document. OCR'd or pdf-parse'd before this point. */
  text: string;
  /**
   * Optional page boundaries. When provided as a sorted list of cumulative
   * character offsets, the provider can attribute each evidence quote to a
   * page. When absent, all evidencePageNumber values come back null.
   */
  pageBreaks?: number[];
  /**
   * Total page count of the source document. Used by the provider to set
   * `meta.pagesCharged` for tier-cap accounting. When omitted, providers
   * estimate from `pageBreaks.length + 1` (correct for PDFs) and fall back
   * to 1 for plain text.
   */
  pageCount?: number;
};

export type ExtractedFieldDraft = {
  fieldKey: AiFieldKey;
  rawValue: string;
  /** Typed value as JSON. Shape varies per fieldKey — see helpers below. */
  parsedValueJson: unknown;
  /** Integer 0..100. Provider self-reports its confidence. */
  confidencePct: number;
  /** Verbatim source quote, ≤500 chars. Required (never null/empty). */
  evidenceQuote: string;
  /** 1-indexed page number, or null if the source has no pages (plain text). */
  evidencePageNumber: number | null;
};

export type ExtractionResult = {
  meta: {
    provider: string;
    model: string;
    promptVersion: string;
    /** Cost in micro-USD (1/1,000,000 dollar). 0 for the stub. */
    costUsdMicros: number;
    /** Pages we should charge to the account's monthly cap. */
    pagesCharged: number;
  };
  fields: ExtractedFieldDraft[];
};

export interface ExtractionProvider {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
}

// ─── Insights ──────────────────────────────────────────────────────────────

/**
 * Shared metadata for every insight response. Lets the UI label which model
 * spoke + how confident it is + which prompt version to attribute it to.
 */
export type InsightMeta = {
  provider: string;
  model: string;
  promptVersion: string;
  /** Integer 0..100. Self-reported. */
  confidencePct: number;
};

/**
 * Risk explainer — narrative reason a renewal is high/medium/low risk.
 * Bound to the deterministic `domain/risk/score.ts` output: the provider
 * only synthesizes a story over the score; it never invents components.
 */
export type RiskExplainerInput = {
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  components: {
    urgency: number;
    value: number;
    clausePressure: number;
  };
  daysUntilNoticeDeadline: number;
  annualValueCents: number;
  autoRenew: boolean;
  isMissed: boolean;
  vendorName: string;
  productName: string;
};

export type RiskExplainerOutput = {
  meta: InsightMeta;
  /** One-line headline, ≤120 chars, suitable for an alert badge. */
  headline: string;
  /** Two- to three-sentence rationale, plain prose. */
  rationale: string;
  /** Ordered next-action suggestions, 1-3 items. */
  suggestedActions: string[];
};

/**
 * Vendor intelligence — synthesis of multi-year vendor history.
 */
export type VendorIntelligenceInput = {
  vendorName: string;
  yearsTracked: number;
  activeSubscriptions: number;
  cancelledSubscriptions: number;
  totalSavedAnnualCents: number;
  averagePriceChangePct: number | null;
  lastDecisionLabel: string | null;
  lastDecisionDate: string | null;
  complianceArtifacts: number;
  expiringComplianceArtifacts: number;
};

export type VendorIntelligenceOutput = {
  meta: InsightMeta;
  /** One-line summary, ≤140 chars. */
  summary: string;
  /** Bullet-point highlights, 2-4 items. */
  highlights: string[];
};

/**
 * NOTE: The standalone "decision recommendation" surface was removed. It was
 * heuristic theater — a verdict produced with no evidence binding, no per-claim
 * provenance, and no confidence, in direct conflict with the no-hallucination
 * bar. Its job is now owned by the Renewal Intelligence Brief
 * (`@server/infrastructure/ai/reasoning`), the single reasoning surface, whose
 * `recommendedAction` carries full evidence + provenance + confidence. The
 * decide-now page reads that brief directly via `getLatestBrief`.
 */

/**
 * Savings narrative — a one-liner story of how the savings were produced.
 */
export type SavingsNarrativeInput = {
  vendorName: string;
  productName: string;
  kind: string;
  baselineAnnualUsdCents: number;
  newAnnualUsdCents: number;
  savedAnnualUsdCents: number;
  negotiationLever: string | null;
  rationaleCodes: string[];
};

export type SavingsNarrativeOutput = {
  meta: InsightMeta;
  /** One-line story, ≤180 chars. */
  narrative: string;
};

export interface AIInsightProvider {
  readonly providerName: string;
  readonly model: string;
  readonly promptVersion: string;
  explainRisk(input: RiskExplainerInput): Promise<RiskExplainerOutput>;
  summarizeVendorIntelligence(
    input: VendorIntelligenceInput
  ): Promise<VendorIntelligenceOutput>;
  narrateSavings(
    input: SavingsNarrativeInput
  ): Promise<SavingsNarrativeOutput>;
}

// ─── Typed parsedValueJson shapes per fieldKey ───────────────────────────────

export type RenewalDateValue = { date: string }; // YYYY-MM-DD
export type NoticePeriodDaysValue = { days: number };
export type AutoRenewalValue = { yes: boolean };
export type ContractValueCentsValue = { cents: number; currency: string };
export type PriceIncreaseClauseValue = { clause: string };
export type CancellationMethodValue = {
  method: "email" | "written_notice" | "portal" | "account_manager" | "unknown";
};
// AI-first generalization — obligation-generic fields. `expiry_date` shares the
// renewal_date apply path (→ termEndDate). `issuer` / `reference_number` land in
// the subscription's attributesJson rather than a dedicated column.
export type ExpiryDateValue = { date: string }; // YYYY-MM-DD
export type IssuerValue = { issuer: string };
export type ReferenceNumberValue = { reference: string };

export type ParsedValueByKey = {
  renewal_date: RenewalDateValue;
  notice_period_days: NoticePeriodDaysValue;
  auto_renewal: AutoRenewalValue;
  contract_value_cents: ContractValueCentsValue;
  price_increase_clause: PriceIncreaseClauseValue;
  cancellation_method: CancellationMethodValue;
  expiry_date: ExpiryDateValue;
  issuer: IssuerValue;
  reference_number: ReferenceNumberValue;
};
