/**
 * OCR factory.
 *
 *   OCR_PROVIDER=pdf-parse-only (default) → PdfParseOnlyOcr
 *   OCR_PROVIDER=mistral                  → MistralNotConfiguredOcr (stub)
 */
import type { OcrProvider } from "./types";
import { PdfParseOnlyOcr } from "./pdf-parse-only";
import { MistralNotConfiguredOcr } from "./mistral-not-configured";

let cached: OcrProvider | null = null;

export function getOcrProvider(): OcrProvider {
  if (cached) return cached;
  const provider = process.env.OCR_PROVIDER ?? "pdf-parse-only";
  switch (provider) {
    case "mistral":
      cached = new MistralNotConfiguredOcr();
      break;
    case "pdf-parse-only":
    default:
      cached = new PdfParseOnlyOcr();
      break;
  }
  return cached;
}

export function _resetOcrProviderForTests(provider?: OcrProvider): void {
  cached = provider ?? null;
}

export type { OcrProvider, TextExtractionResult } from "./types";
