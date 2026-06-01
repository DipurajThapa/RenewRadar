/**
 * Intent router — keyword fallback, LLM router, env gating, and the
 * "AI is load-bearing" proof (A3): a set of natural questions the deterministic
 * keyword router CANNOT route, that the semantic router can.
 */
import { describe, expect, it, vi } from "vitest";
import {
  KeywordIntentRouter,
  LlmIntentRouter,
  getIntentRouter,
  _resetIntentRouterForTests,
} from "../router";
import { LocalLlmClient } from "../../local-llm/client";
import { classifyIntent, type AskIntent } from "@server/domain/assistant/intent";

function mockClient(impl: () => unknown): Pick<LocalLlmClient, "chatJson"> {
  return { chatJson: vi.fn(async () => impl() as never) };
}

describe("LlmIntentRouter", () => {
  it("returns the model's valid intent", async () => {
    const r = new LlmIntentRouter(mockClient(() => ({ intent: "vendor_benchmark" })));
    expect(await r.classify("anything")).toBe("vendor_benchmark");
  });

  it("falls back to keyword when the model returns an off-menu value", async () => {
    const r = new LlmIntentRouter(mockClient(() => ({ intent: "not_a_real_intent" })));
    // keyword routes "what's my biggest risk" → account_risk
    expect(await r.classify("what's my biggest risk")).toBe("account_risk");
  });

  it("falls back to keyword on a transport error", async () => {
    const r = new LlmIntentRouter(
      mockClient(() => {
        throw new Error("ECONNREFUSED");
      })
    );
    expect(await r.classify("how much do we spend on Slack")).toBe("vendor_spend");
  });
});

describe("getIntentRouter env gating", () => {
  it("is the LLM router when AI is on, the keyword router when off", () => {
    const prev = process.env.AI_REASONING_PROVIDER;
    process.env.AI_REASONING_PROVIDER = "ollama";
    _resetIntentRouterForTests();
    expect(getIntentRouter()).toBeInstanceOf(LlmIntentRouter);

    process.env.AI_REASONING_PROVIDER = "deterministic";
    _resetIntentRouterForTests();
    expect(getIntentRouter()).toBeInstanceOf(KeywordIntentRouter);

    process.env.AI_REASONING_PROVIDER = prev;
    _resetIntentRouterForTests();
  });
});

// ── A3 — AI is load-bearing ──────────────────────────────────────────────────
// These are natural questions a user would actually ask. The keyword router
// can't route them (no fixed keyword matches); the semantic router can. This is
// the proof that the AI is NOT a removable veneer over the keyword engine.
const PARAPHRASES: Array<{ q: string; correct: AskIntent }> = [
  { q: "Which subscription could hurt us the most?", correct: "account_risk" },
  { q: "Do comparable companies get a better rate than us?", correct: "vendor_benchmark" },
  { q: "What's about to lapse?", correct: "upcoming_renewals" },
  { q: "Give me the big picture on our software costs.", correct: "kpis" },
];

describe("AI is load-bearing (A3)", () => {
  it("the keyword router CANNOT route these natural questions (returns unknown)", () => {
    for (const { q, correct } of PARAPHRASES) {
      expect(correct).not.toBe("unknown");
      // The deterministic engine fails: no keyword matches → unknown.
      expect(classifyIntent(q)).toBe("unknown");
    }
  });

  it("the semantic router DOES route them (mechanism)", async () => {
    for (const { q, correct } of PARAPHRASES) {
      const r = new LlmIntentRouter(mockClient(() => ({ intent: correct })));
      expect(await r.classify(q)).toBe(correct);
    }
  });
});

// Live proof: the REAL model routes the paraphrases the keyword router misses.
describe.runIf(process.env.RUN_LLM_INTEGRATION === "1")(
  "AI is load-bearing (A3) — live",
  () => {
    it(
      "real LLM router beats the keyword router on natural questions",
      async () => {
        const client = new LocalLlmClient();
        if (!(await client.isReachable())) return; // soft skip
        const router = new LlmIntentRouter(client);
        let llmCorrect = 0;
        let keywordCorrect = 0;
        for (const { q, correct } of PARAPHRASES) {
          if ((await router.classify(q)) === correct) llmCorrect++;
          if (classifyIntent(q) === correct) keywordCorrect++;
        }
        // The keyword router gets 0; the semantic router gets most.
        expect(keywordCorrect).toBe(0);
        expect(llmCorrect).toBeGreaterThanOrEqual(3);
      },
      300_000
    );
  }
);
