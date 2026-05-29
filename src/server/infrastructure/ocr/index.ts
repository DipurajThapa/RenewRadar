/**
 * OCR factory.
 *
 *   OCR_PROVIDER=local   (default) → LocalTextExtractor
 *                                    (PDF + DOCX + XLSX + text/markdown/CSV)
 *   OCR_PROVIDER=mistral            → MistralNotConfiguredOcr (production stub)
 *
 * Back-compat: the old value "pdf-parse-only" still resolves to the local
 * extractor so existing deployments don't break on rename.
 */
import type { OcrProvider } from "./types";
import { LocalTextExtractor } from "./local-text-extractor";
import { MistralNotConfiguredOcr } from "./mistral-not-configured";

let cached: OcrProvider | null = null;

export function getOcrProvider(): OcrProvider {
  if (cached) return cached;
  const provider = process.env.OCR_PROVIDER ?? "local";
  switch (provider) {
    case "mistral":
      cached = new MistralNotConfiguredOcr();
      break;
    case "local":
    case "pdf-parse-only":
    default:
      cached = new LocalTextExtractor();
      break;
  }
  return cached;
}

export function _resetOcrProviderForTests(provider?: OcrProvider): void {
  cached = provider ?? null;
}

export type { OcrProvider, TextExtractionResult } from "./types";
