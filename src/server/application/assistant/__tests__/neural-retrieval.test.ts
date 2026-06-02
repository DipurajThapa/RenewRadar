/**
 * NEURAL embedding retrieval — live proof (Phase A). Gated by RUN_LLM_INTEGRATION
 * so it's skipped in normal/CI runs (no embed model there). Run it with:
 *   RUN_LLM_INTEGRATION=1 AI_EMBEDDINGS_PROVIDER=ollama \
 *   LOCAL_EMBED_MODEL=nomic-embed-text pnpm exec dotenv -e .env.test -- \
 *   vitest run src/server/application/assistant/__tests__/neural-retrieval.test.ts
 *
 * Proves the neural path is BOTH load-bearing (surfaces facts for a synonym
 * question that shares no words) AND honest (returns [] for an unrelated question)
 * — i.e. the scale-robust separation gate holds on the neural cosine scale.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { renewalEventsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { _resetEmbeddingsProviderForTests, getEmbeddingsProvider } from "@server/infrastructure/ai/embeddings";
import { semanticRetrieveFacts } from "@server/application/assistant/semantic-retrieve";

const RUN = process.env.RUN_LLM_INTEGRATION === "1";

describe.runIf(RUN)("neural embedding retrieval — live", () => {
  let ids: SeedTwoAccountsResult;

  beforeAll(async () => {
    await ensureMigrated();
    process.env.AI_EMBEDDINGS_PROVIDER = "ollama";
    process.env.LOCAL_EMBED_MODEL = process.env.LOCAL_EMBED_MODEL ?? "all-minilm";
    _resetEmbeddingsProviderForTests();
  });

  beforeEach(async () => {
    await truncateAll();
    ids = await seedTwoAccounts();
    await db
      .update(renewalEventsTable)
      .set({ status: "notice_window" })
      .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
  });

  it("uses the neural provider (not the lexical fallback)", () => {
    expect(getEmbeddingsProvider().providerName).toBe("ollama-embed");
  });

  it("LOAD-BEARING: surfaces relevant facts for a pure-synonym question (no shared words)", async () => {
    // "worried" shares NO word with "Biggest risk: …" — only NEURAL semantics
    // connects them. The keyword router + lexical embedding cannot.
    const facts = await semanticRetrieveFacts(
      ids.accountA.id,
      "what should I be worried about?",
      "unknown"
    );
    expect(facts.length).toBeGreaterThan(0);
  });

  it("HONEST: returns [] for a truly unrelated question (no answering from noise)", async () => {
    const facts = await semanticRetrieveFacts(ids.accountA.id, "what's the weather in Tokyo today?", "unknown");
    expect(facts).toEqual([]);
  });
});
