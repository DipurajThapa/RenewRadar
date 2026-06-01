/**
 * Retriever factory.
 *
 *   RETRIEVER_PROVIDER unset (default) → null (use the deterministic application
 *                                        dispatch in application/assistant/retrieve)
 *   RETRIEVER_PROVIDER=vector          → VectorRetrieverNotConfigured (dormant)
 *
 * Returns null by default — the application composer falls back to the
 * deterministic SQL dispatch when no vector provider is configured.
 */
import type { RetrieverProvider } from "./types";
import { VectorRetrieverNotConfigured } from "./vector-not-configured";

let cached: RetrieverProvider | null = null;
let resolved = false;

export function getRetriever(): RetrieverProvider | null {
  if (resolved) return cached;
  resolved = true;
  cached =
    process.env.RETRIEVER_PROVIDER === "vector"
      ? new VectorRetrieverNotConfigured()
      : null;
  return cached;
}

/** Test-only: inject a provider, or call with no args to re-read the env. */
export function _setRetrieverForTests(provider?: RetrieverProvider | null): void {
  if (provider === undefined) {
    cached = null;
    resolved = false;
    return;
  }
  cached = provider;
  resolved = true;
}

export type { RetrieverProvider, RetrievalRequest } from "./types";
