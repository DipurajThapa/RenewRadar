/**
 * Embeddings factory.
 *
 *   AI_EMBEDDINGS_PROVIDER unset / "lexical" (default) → LexicalEmbeddingsProvider
 *                                                        (deterministic, model-free)
 *   AI_EMBEDDINGS_PROVIDER = "ollama"                  → OllamaEmbeddingsProvider
 *                                                        (neural; self-falls-back
 *                                                         to lexical)
 *
 * Default is lexical so semantic retrieval works everywhere with zero setup; flip
 * to ollama (+ `ollama pull nomic-embed-text`) for true neural embeddings — a
 * config swap, no code change.
 */
import type { EmbeddingsProvider } from "./types";
import { LexicalEmbeddingsProvider } from "./lexical";
import { OllamaEmbeddingsProvider } from "./ollama";

let cached: EmbeddingsProvider | null = null;

export function getEmbeddingsProvider(): EmbeddingsProvider {
  if (cached) return cached;
  cached =
    process.env.AI_EMBEDDINGS_PROVIDER === "ollama"
      ? new OllamaEmbeddingsProvider()
      : new LexicalEmbeddingsProvider();
  return cached;
}

export function _resetEmbeddingsProviderForTests(provider?: EmbeddingsProvider | null): void {
  cached = provider ?? null;
}

export type { EmbeddingsProvider } from "./types";
export { cosineSimilarity, rankBySimilarity, l2normalize } from "./vector";
export type { RankedItem } from "./vector";
