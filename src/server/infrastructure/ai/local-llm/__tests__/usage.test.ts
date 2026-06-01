/**
 * AI unit economics (Phase 6, F1/F3) — token extraction from both dialects, the
 * cost model, the process usage meter, the budget guard, and the client→meter
 * wiring (a real call's token counts land in the shared meter).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UsageMeter,
  checkBudget,
  estimateCostUsdMicros,
  resolvePricing,
  sharedMeter,
  usageFromOllama,
  usageFromOpenAi,
  type Pricing,
} from "../usage";
import { LocalLlmClient } from "../client";
import { _resetBreakersForTests } from "../breaker";

describe("usageFromOllama", () => {
  it("reads prompt_eval_count + eval_count", () => {
    expect(usageFromOllama({ prompt_eval_count: 787, eval_count: 23 })).toEqual({
      promptTokens: 787,
      completionTokens: 23,
      totalTokens: 810,
    });
  });

  it("is zero-safe when the model omits counts", () => {
    expect(usageFromOllama({ message: { content: "{}" } })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(usageFromOllama(null)).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

describe("usageFromOpenAi", () => {
  it("reads usage.{prompt,completion,total}_tokens", () => {
    expect(
      usageFromOpenAi({ usage: { prompt_tokens: 500, completion_tokens: 120, total_tokens: 620 } })
    ).toEqual({ promptTokens: 500, completionTokens: 120, totalTokens: 620 });
  });

  it("derives total when the server omits it", () => {
    expect(usageFromOpenAi({ usage: { prompt_tokens: 10, completion_tokens: 5 } }).totalTokens).toBe(15);
  });
});

describe("resolvePricing + estimateCostUsdMicros", () => {
  it("parses dollars-per-1k into micro-USD per 1k", () => {
    const p = resolvePricing({
      LLM_PRICE_INPUT_PER_1K: "0.15",
      LLM_PRICE_OUTPUT_PER_1K: "0.60",
    } as unknown as NodeJS.ProcessEnv);
    expect(p).toEqual({ inputPer1kUsdMicros: 150_000, outputPer1kUsdMicros: 600_000 });
  });

  it("defaults to free (local model) when unset", () => {
    const p = resolvePricing({} as NodeJS.ProcessEnv);
    expect(p).toEqual({ inputPer1kUsdMicros: 0, outputPer1kUsdMicros: 0 });
    expect(estimateCostUsdMicros({ promptTokens: 5000, completionTokens: 1000, totalTokens: 6000 }, p)).toBe(0);
  });

  it("prices prompt + completion tokens separately", () => {
    const p: Pricing = { inputPer1kUsdMicros: 150_000, outputPer1kUsdMicros: 600_000 };
    // 2000 prompt → 300_000; 500 completion → 300_000; total 600_000 micros = $0.60.
    expect(
      estimateCostUsdMicros({ promptTokens: 2000, completionTokens: 500, totalTokens: 2500 }, p)
    ).toBe(600_000);
  });
});

describe("UsageMeter", () => {
  it("accumulates calls, tokens, and cost; averages; resets", () => {
    const m = new UsageMeter();
    m.record({ promptTokens: 100, completionTokens: 20, totalTokens: 120 }, 500);
    m.record({ promptTokens: 300, completionTokens: 80, totalTokens: 380 }, 1500);
    const s = m.stats();
    expect(s.calls).toBe(2);
    expect(s.promptTokens).toBe(400);
    expect(s.completionTokens).toBe(100);
    expect(s.totalTokens).toBe(500);
    expect(s.costUsdMicros).toBe(2000);
    expect(s.avgCostUsdMicros).toBe(1000);
    expect(s.avgTokens).toBe(250);
    m.reset();
    expect(m.stats().calls).toBe(0);
  });
});

describe("checkBudget (F3 — the spend cap)", () => {
  it("allows under the cap and reports remaining", () => {
    const c = checkBudget(400_000, 1_000_000);
    expect(c.allowed).toBe(true);
    expect(c.remainingUsdMicros).toBe(600_000);
  });

  it("denies at or over the cap (degrade to deterministic, never overbill)", () => {
    expect(checkBudget(1_000_000, 1_000_000).allowed).toBe(false);
    expect(checkBudget(1_200_000, 1_000_000).remainingUsdMicros).toBe(0);
  });

  it("treats a cap of 0 as unlimited", () => {
    const c = checkBudget(9_999_999, 0);
    expect(c.allowed).toBe(true);
    expect(c.remainingUsdMicros).toBe(Infinity);
  });
});

describe("client → meter wiring (F1)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    _resetBreakersForTests();
    sharedMeter.reset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records real token counts from a successful ollama call", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"ok":true}' }, prompt_eval_count: 640, eval_count: 48 }),
      text: async () => "",
    });
    const client = new LocalLlmClient({ apiStyle: "ollama", baseUrl: "http://localhost:11434" });
    await client.chatJson({ system: "s", user: "u" });
    const s = sharedMeter.stats();
    expect(s.calls).toBe(1);
    expect(s.promptTokens).toBe(640);
    expect(s.completionTokens).toBe(48);
  });

  it("does not meter a token-less envelope", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"ok":true}' } }),
      text: async () => "",
    });
    await new LocalLlmClient({ apiStyle: "ollama" }).chatJson({ system: "s", user: "u" });
    expect(sharedMeter.stats().calls).toBe(0);
  });
});
