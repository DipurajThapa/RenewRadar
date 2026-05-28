/**
 * OCR / text extraction interface.
 *
 * We always try pdf-parse first (free, in-process, fast). When pdf-parse
 * returns fewer than ~100 characters we treat the PDF as image-based and
 * fall back to the OCR provider — Mistral OCR in production.
 *
 * The TextExtractionResult is provider-agnostic: callers don't care whether
 * the text came from pdf-parse or from OCR, only that it carries a
 * page-break offset list for evidence attribution.
 */
export type TextExtractionResult = {
  text: string;
  pageCount: number;
  /**
   * Cumulative character offsets where each new page starts (excluding page 1
   * which starts at 0). Used by the AI provider to attach page numbers to
   * extracted fields.
   */
  pageBreaks: number[];
  /** True if we fell through to OCR. Useful for usage analytics. */
  usedOcr: boolean;
  /** Provider identifier — surfaced in audit/log entries. */
  providerName: string;
};

export interface OcrProvider {
  extract(input: { bytes: Buffer; mimeType: string }): Promise<TextExtractionResult>;
  readonly providerName: string;
}
