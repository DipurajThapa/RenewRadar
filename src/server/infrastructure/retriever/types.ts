/**
 * Retriever seam — the swap point for a future vector-search retrieval path.
 * The WORKING default lives in the application layer
 * (`application/assistant/retrieve.ts`, deterministic SQL dispatch); this seam
 * holds only the interface + the dormant vector scaffold, so a vector store can
 * plug in later (`RETRIEVER_PROVIDER=vector`) without touching callers.
 */
import type { AskIntent } from "@server/domain/assistant/intent";
import type { RetrievedFact } from "@server/infrastructure/ai/reasoning/types";

export type RetrievalRequest = {
  accountId: string;
  question: string;
  intent: AskIntent;
};

export interface RetrieverProvider {
  readonly providerName: string;
  retrieve(req: RetrievalRequest): Promise<RetrievedFact[]>;
}
