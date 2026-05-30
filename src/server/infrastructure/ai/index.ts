/**
 * AI provider factory.
 *
 *   AI_EXTRACTION_PROVIDER=heuristic-stub (default) → HeuristicStubProvider
 *   AI_EXTRACTION_PROVIDER=anthropic                → real Anthropic if
 *                                                     ANTHROPIC_API_KEY is set,
 *                                                     otherwise heuristic stub
 *                                                     (with a one-time warning)
 *
 * The factory protects ops from the misconfigured-key footgun: setting the
 * env to `anthropic` without provisioning the key would otherwise throw on
 * every extraction. We silently fall back so document upload + review keeps
 * working in dev/staging while the real key is being provisioned.
 *
 * The same factory hands out the AI insight provider (risk explainer,
 * vendor intelligence summary, decision recommendation, savings narrative).
 * Today these all use the heuristic stack — the production swap is the same
 * `anthropic` env-flag flip, but only after the corresponding methods land
 * in the Anthropic provider.
 */
import type { AIInsightProvider, ExtractionProvider } from "./types";
import { HeuristicStubProvider } from "./heuristic-stub-provider";
import { AnthropicNotConfiguredProvider } from "./anthropic-not-configured";
import type { ReasoningProvider } from "./reasoning/types";
import { DeterministicReasoningProvider } from "./reasoning/deterministic-provider";
import { AnthropicReasoningProvider } from "./reasoning/anthropic-provider";

let cached: HeuristicStubProvider | AnthropicNotConfiguredProvider | null = null;
let warnedFallback = false;
let cachedReasoning: ReasoningProvider | null = null;

function build():
  | HeuristicStubProvider
  | AnthropicNotConfiguredProvider {
  const provider = process.env.AI_EXTRACTION_PROVIDER ?? "heuristic-stub";
  switch (provider) {
    case "anthropic": {
      // Anthropic mode is only safe to instantiate when the key is set —
      // otherwise the stub throws on every call. We fall back to the
      // heuristic so the upload + review workflow stays usable in dev.
      const hasKey =
        typeof process.env.ANTHROPIC_API_KEY === "string" &&
        process.env.ANTHROPIC_API_KEY.length > 0;
      if (!hasKey) {
        if (!warnedFallback) {
          console.warn(
            "[ai] AI_EXTRACTION_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset — falling back to heuristic-stub."
          );
          warnedFallback = true;
        }
        return new HeuristicStubProvider();
      }
      return new AnthropicNotConfiguredProvider();
    }
    case "heuristic-stub":
    default:
      return new HeuristicStubProvider();
  }
}

/**
 * The extraction provider: structured field extraction from contract text.
 */
export function getExtractionProvider(): ExtractionProvider {
  if (cached) return cached;
  cached = build();
  return cached;
}

/**
 * The insight provider: risk explanations, vendor intelligence summaries,
 * decision recommendations, savings narratives.
 *
 * Today this is the same instance as the extraction provider (both stubs
 * implement both interfaces). They're exposed as separate methods so the
 * production split — keep extraction on Sonnet, route insights to a faster
 * model — only changes this file.
 */
export function getInsightProvider(): AIInsightProvider {
  if (cached) return cached;
  cached = build();
  return cached;
}

export function _resetExtractionProviderForTests(
  provider?: HeuristicStubProvider | AnthropicNotConfiguredProvider | null
): void {
  cached = provider ?? null;
  warnedFallback = false;
}

/**
 * Renewal Intelligence Brief reasoner. Dedicated `AI_REASONING_PROVIDER` flag
 * (NOT the extraction flag) so flipping contract extraction to Anthropic
 * doesn't silently flip briefs too. Default = the genuinely-working offline
 * DeterministicReasoningProvider; the LLM is constructed only with both the
 * flag AND a key. The fallback NEVER mints a brief labeled "llm".
 */
export function getReasoningProvider(): ReasoningProvider {
  if (cachedReasoning) return cachedReasoning;
  const flag = process.env.AI_REASONING_PROVIDER ?? "deterministic";
  if (flag === "anthropic") {
    const hasKey =
      typeof process.env.ANTHROPIC_API_KEY === "string" &&
      process.env.ANTHROPIC_API_KEY.length > 0;
    cachedReasoning = hasKey
      ? new AnthropicReasoningProvider()
      : new DeterministicReasoningProvider();
  } else {
    cachedReasoning = new DeterministicReasoningProvider();
  }
  return cachedReasoning;
}

export function _resetReasoningProviderForTests(
  provider?: ReasoningProvider | null
): void {
  cachedReasoning = provider ?? null;
}

export type { ReasoningProvider, RenewalIntelligenceBrief, RenewalBriefInput } from "./reasoning/types";

export type {
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  ExtractedFieldDraft,
  ParsedValueByKey,
  AIInsightProvider,
  RiskExplainerInput,
  RiskExplainerOutput,
  VendorIntelligenceInput,
  VendorIntelligenceOutput,
  SavingsNarrativeInput,
  SavingsNarrativeOutput,
} from "./types";
