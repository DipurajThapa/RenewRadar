import type { RetrievedFact } from "@server/infrastructure/ai/reasoning/types";
import type { RetrievalRequest, RetrieverProvider } from "./types";

/**
 * Dormant vector-retrieval scaffold — only constructed when
 * RETRIEVER_PROVIDER=vector (a future, keys-on configuration). Until a vector
 * store is wired, it fails loudly with setup guidance; the shipped default is
 * the deterministic application dispatch, so this path is unreachable in normal
 * config.
 */
export class VectorRetrieverNotConfigured implements RetrieverProvider {
  readonly providerName = "vector-not-configured";

  async retrieve(_req: RetrievalRequest): Promise<RetrievedFact[]> {
    throw new Error(
      "RETRIEVER_PROVIDER=vector but no vector store is configured. " +
        "Leave RETRIEVER_PROVIDER unset to use the deterministic SQL-dispatch retriever."
    );
  }
}
