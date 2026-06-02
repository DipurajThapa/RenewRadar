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
import { LocalLlmExtractionProvider } from "./local-llm/extraction-provider";
import type { ReasoningProvider } from "./reasoning/types";
import { DeterministicReasoningProvider } from "./reasoning/deterministic-provider";
import { AnthropicReasoningProvider } from "./reasoning/anthropic-provider";
import { OllamaReasoningProvider } from "./reasoning/ollama-provider";

let cached:
  | HeuristicStubProvider
  | AnthropicNotConfiguredProvider
  | LocalLlmExtractionProvider
  | null = null;
let warnedFallback = false;
let cachedReasoning: ReasoningProvider | null = null;

function build():
  | HeuristicStubProvider
  | AnthropicNotConfiguredProvider
  | LocalLlmExtractionProvider {
  // AI-first by default: the shipped experience uses the local LLM. It
  // self-falls-back to the heuristic extractor per-call when no model server is
  // reachable, so a model-less environment still works (just deterministically).
  const provider = process.env.AI_EXTRACTION_PROVIDER ?? "ollama";
  switch (provider) {
    case "ollama":
    case "local":
      // Local-LLM extraction (default qwen3.6 via Ollama). Always safe to
      // construct: it self-falls-back to the heuristic engine per-call when the
      // model server is unreachable or returns nothing it can quote verbatim.
      return new LocalLlmExtractionProvider();
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
  provider?:
    | HeuristicStubProvider
    | AnthropicNotConfiguredProvider
    | LocalLlmExtractionProvider
    | null
): void {
  cached = provider ?? null;
  warnedFallback = false;
}

/**
 * Renewal Intelligence Brief reasoner. Dedicated `AI_REASONING_PROVIDER` flag
 * (NOT the extraction flag) so flipping contract extraction doesn't silently
 * flip briefs too. Options:
 *   ollama | local (DEFAULT) — local LLM (default qwen3.6 via Ollama). No key;
 *                             self-falls-back to the deterministic engine
 *                             per-call on any failure, so it's always safe.
 *                             Surviving LLM claims are held to the shared
 *                             `validateBrief` grounding gate (cited source must
 *                             exist; no invented figures).
 *   deterministic           — the offline, no-LLM engine; select to pin briefs
 *                             to pure deterministic reasoning (used in tests).
 *   anthropic               — hosted Claude; constructed only with flag AND key.
 * No path EVER mints a brief labeled "llm" unless a grounded LLM claim survived
 * the shared validator.
 */
export function getReasoningProvider(): ReasoningProvider {
  if (cachedReasoning) return cachedReasoning;
  // AI-first by default. Always safe: the local-LLM provider self-falls-back to
  // the deterministic engine per-call when the model is unreachable.
  const flag = process.env.AI_REASONING_PROVIDER ?? "ollama";
  if (flag === "anthropic") {
    const hasKey =
      typeof process.env.ANTHROPIC_API_KEY === "string" &&
      process.env.ANTHROPIC_API_KEY.length > 0;
    cachedReasoning = hasKey
      ? new AnthropicReasoningProvider()
      : new DeterministicReasoningProvider();
  } else if (flag === "ollama" || flag === "local") {
    // Local-LLM path (default qwen3.6 via Ollama). Always safe to construct:
    // it self-falls-back to the deterministic engine per-call when the model
    // server is unreachable, times out, or returns nothing grounded — so a
    // missing/offline model degrades to deterministic instead of throwing.
    cachedReasoning = new OllamaReasoningProvider();
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

let cachedFallbackReasoning: ReasoningProvider | null = null;

/**
 * The deterministic reasoner, explicitly. Used as the "degraded mode" served when
 * an account is over its monthly AI-reasoning budget (F3) — free, grounded, and
 * never an LLM call. Separate from `getReasoningProvider()` so the budget guard
 * can force it regardless of the configured default.
 */
export function getFallbackReasoningProvider(): ReasoningProvider {
  if (!cachedFallbackReasoning) {
    cachedFallbackReasoning = new DeterministicReasoningProvider();
  }
  return cachedFallbackReasoning;
}

export function _resetFallbackReasoningProviderForTests(
  provider?: ReasoningProvider | null
): void {
  cachedFallbackReasoning = provider ?? null;
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
