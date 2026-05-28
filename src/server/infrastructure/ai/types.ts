/**
 * AI extraction provider interface.
 *
 * Pluggable. The heuristic stub backs development; the Anthropic Claude
 * Sonnet 4.6 provider backs production. Both return the same shape so the
 * application layer never knows which is in use.
 *
 * Binding principle 4: every field MUST carry `evidenceQuote` + (when the
 * source supports it) `evidencePageNumber`. Fields missing evidence are
 * rejected at the validation step in `application/documents/extract.ts`
 * — they never reach the database.
 */
import type { AiFieldKey } from "@server/infrastructure/db/schema";

export type ExtractionInput = {
  /** Plain text of the document. OCR'd or pdf-parse'd before this point. */
  text: string;
  /**
   * Optional page boundaries. When provided as a sorted list of cumulative
   * character offsets, the provider can attribute each evidence quote to a
   * page. When absent, all evidencePageNumber values come back null.
   */
  pageBreaks?: number[];
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

// ─── Typed parsedValueJson shapes per fieldKey ───────────────────────────────

export type RenewalDateValue = { date: string }; // YYYY-MM-DD
export type NoticePeriodDaysValue = { days: number };
export type AutoRenewalValue = { yes: boolean };
export type ContractValueCentsValue = { cents: number; currency: string };
export type PriceIncreaseClauseValue = { clause: string };
export type CancellationMethodValue = {
  method: "email" | "written_notice" | "portal" | "account_manager" | "unknown";
};

export type ParsedValueByKey = {
  renewal_date: RenewalDateValue;
  notice_period_days: NoticePeriodDaysValue;
  auto_renewal: AutoRenewalValue;
  contract_value_cents: ContractValueCentsValue;
  price_increase_clause: PriceIncreaseClauseValue;
  cancellation_method: CancellationMethodValue;
};
