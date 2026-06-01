/**
 * Streaming Ask (Phase B/B5) — first-token latency. Proves the instant grounded
 * preamble is emitted BEFORE the (multi-second) reasoning model is ever invoked,
 * so first-token is bounded by retrieval, not the LLM — without ever streaming
 * unvalidated model text.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { renewalEventsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { _resetReasoningProviderForTests } from "@server/infrastructure/ai";
import type { ReasoningProvider } from "@server/infrastructure/ai/reasoning/types";
import { streamAccountQuestion } from "@server/application/assistant";

let ids: SeedTwoAccountsResult;
let modelCalled = false;

const spyProvider: ReasoningProvider = {
  providerName: "spy",
  model: "spy",
  promptVersion: "v1",
  buildBrief: async () => {
    throw new Error("not used");
  },
  answerQuestion: async (input) => {
    modelCalled = true;
    return {
      meta: { provider: "spy", model: "spy", promptVersion: "v1", confidencePct: 70, engine: "deterministic" },
      question: input.question,
      summary: "ok",
      answers: input.facts.slice(0, 1).map((f) => ({
        statement: f.detail,
        engine: "deterministic" as const,
        confidencePct: 70,
        evidence: [f],
      })),
      missingInfo: [],
      deepLinks: [],
    };
  },
};

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(eq(renewalEventsTable.id, ids.accountA.renewalEventId));
  modelCalled = false;
  _resetReasoningProviderForTests(spyProvider);
});

afterEach(() => _resetReasoningProviderForTests(null));

describe("streamAccountQuestion", () => {
  it("emits the grounded preamble BEFORE the model is called", async () => {
    const gen = streamAccountQuestion(ids.accountA.id, "what's my biggest risk?");

    const first = await gen.next();
    expect(first.value.type).toBe("preamble");
    if (first.value.type === "preamble") {
      expect(first.value.factCount).toBeGreaterThan(0);
    }
    // The defining property: first-token did NOT wait on the reasoning model.
    expect(modelCalled).toBe(false);

    const second = await gen.next();
    expect(second.value.type).toBe("answer");
    expect(modelCalled).toBe(true);
    if (second.value.type === "answer") {
      expect(second.value.answer.answers.length).toBeGreaterThan(0);
    }
  });

  it("streams an honest preamble for an unanswerable question", async () => {
    const gen = streamAccountQuestion(ids.accountA.id, "what's the weather today?");
    const first = await gen.next();
    expect(first.value.type).toBe("preamble");
    if (first.value.type === "preamble") {
      expect(first.value.factCount).toBe(0);
      expect(first.value.text.toLowerCase()).toContain("couldn't find");
    }
  });
});
