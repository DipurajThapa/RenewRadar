/**
 * AI evaluation types — the measurement spine (Phase 1).
 *
 * These describe a synthetic, ground-truth-labeled contract corpus and the
 * scoring of an extraction run against it. Everything here is pure + typed so
 * the F1/ECE/escape logic is unit-tested offline; only the model call (in the
 * benchmark orchestrator) needs a live model.
 */

/** The high-signal fields we score for F1 (the ones the product acts on). */
export type EvalFieldKey =
  | "renewal_date"
  | "notice_period_days"
  | "auto_renewal"
  | "contract_value_cents";

export const EVAL_FIELD_KEYS: EvalFieldKey[] = [
  "renewal_date",
  "notice_period_days",
  "auto_renewal",
  "contract_value_cents",
];

export type FieldTruth = {
  renewal_date?: string; // YYYY-MM-DD
  notice_period_days?: number;
  auto_renewal?: boolean;
  contract_value_cents?: number;
};

export type CorpusVariant =
  | "clean"
  | "ocr_noise"
  | "multilingual"
  | "adversarial";

export type CorpusLanguage = "en" | "es" | "fr" | "de";

/** A value the model MUST NOT extract — injection/decoy bait in adversarial docs. */
export type Trap = {
  fieldKey: EvalFieldKey;
  forbiddenValue: string | number | boolean;
  note: string;
};

export type GoldenContract = {
  id: string;
  variant: CorpusVariant;
  language: CorpusLanguage;
  text: string;
  truth: FieldTruth;
  /** Empty for non-adversarial contracts. */
  traps: Trap[];
};

// ─── Scoring ────────────────────────────────────────────────────────────────

export type ConfidencePoint = { confidencePct: number; correct: boolean };

export type PrfCounts = { tp: number; fp: number; fn: number };

export type PrfScore = PrfCounts & {
  precision: number;
  recall: number;
  f1: number;
};

export type VariantScore = {
  variant: CorpusVariant | "overall";
  contracts: number;
  prf: PrfScore;
};

export type ExtractionEvalReport = {
  contracts: number;
  overall: PrfScore;
  perVariant: VariantScore[];
  /** Predicted fields whose evidence quote was NOT in the source (must be 0). */
  hallucinationEscapes: number;
  /** Adversarial trap/injection values the model wrongly extracted (must be 0). */
  injectionEscapes: number;
  /** Expected calibration error in [0,1] (lower is better). */
  ece: number;
  reliability: Array<{
    bucket: string;
    avgConfidencePct: number;
    accuracyPct: number;
    count: number;
  }>;
};
