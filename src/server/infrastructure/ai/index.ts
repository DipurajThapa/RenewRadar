/**
 * AI extraction provider factory.
 *
 *   AI_EXTRACTION_PROVIDER=heuristic-stub (default) → HeuristicStubProvider
 *   AI_EXTRACTION_PROVIDER=anthropic                → AnthropicNotConfiguredProvider (stub)
 */
import type { ExtractionProvider } from "./types";
import { HeuristicStubProvider } from "./heuristic-stub-provider";
import { AnthropicNotConfiguredProvider } from "./anthropic-not-configured";

let cached: ExtractionProvider | null = null;

export function getExtractionProvider(): ExtractionProvider {
  if (cached) return cached;
  const provider = process.env.AI_EXTRACTION_PROVIDER ?? "heuristic-stub";
  switch (provider) {
    case "anthropic":
      cached = new AnthropicNotConfiguredProvider();
      break;
    case "heuristic-stub":
    default:
      cached = new HeuristicStubProvider();
      break;
  }
  return cached;
}

export function _resetExtractionProviderForTests(
  provider?: ExtractionProvider
): void {
  cached = provider ?? null;
}

export type {
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  ExtractedFieldDraft,
  ParsedValueByKey,
} from "./types";
