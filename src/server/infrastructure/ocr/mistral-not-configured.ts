/**
 * Mistral OCR fallback — production scaffold.
 *
 * The real implementation:
 *   1. pnpm add @mistralai/mistralai
 *   2. Set MISTRAL_API_KEY in env
 *   3. For image-only PDFs, send each page to the OCR endpoint
 *   4. Concatenate the per-page text + record page boundaries
 *   5. Return the same TextExtractionResult shape
 *
 * Until then, leave OCR_PROVIDER unset (defaults to "local").
 */
import type { OcrProvider, TextExtractionResult } from "./types";

export class MistralNotConfiguredOcr implements OcrProvider {
  readonly providerName = "mistral-not-configured";

  async extract(): Promise<TextExtractionResult> {
    throw new Error(
      "Mistral OCR provider is not configured. To enable:\n" +
        "  1. pnpm add @mistralai/mistralai\n" +
        "  2. Set MISTRAL_API_KEY in your env\n" +
        "  3. Replace this class with a real Mistral OCR call.\n" +
        "Until then, leave OCR_PROVIDER unset (defaults to \"local\")."
    );
  }
}
