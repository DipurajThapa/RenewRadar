/**
 * Embeddings + vector math (Phase 3/A) — the substrate for semantic retrieval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cosineSimilarity, rankBySimilarity, l2normalize } from "../vector";
import { LexicalEmbeddingsProvider, lexicalEmbed } from "../lexical";
import { OllamaEmbeddingsProvider } from "../ollama";

describe("vector math", () => {
  it("cosine of identical vectors is 1, orthogonal is 0", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("l2normalize yields a unit vector", () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1);
  });

  it("rankBySimilarity orders by descending cosine and respects topK", () => {
    const q = [1, 0];
    const items = ["a", "b", "c"];
    const vecs = [[0, 1], [0.9, 0.1], [1, 0]];
    const ranked = rankBySimilarity(q, items, vecs, 2);
    expect(ranked.map((r) => r.item)).toEqual(["c", "b"]);
  });
});

describe("lexical embeddings", () => {
  it("are deterministic", () => {
    expect(lexicalEmbed("annual renewal")).toEqual(lexicalEmbed("annual renewal"));
  });

  it("rank a paraphrase nearer than an unrelated string (term/n-gram overlap)", () => {
    const q = lexicalEmbed("when does my contract renew");
    const related = lexicalEmbed("the renewal date of the contract");
    const unrelated = lexicalEmbed("compliance certificate expiry for the vendor portal");
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });

  it("are robust to a typo (shared char 3-grams)", () => {
    const a = lexicalEmbed("renewal");
    const b = lexicalEmbed("renewl"); // typo
    const c = lexicalEmbed("invoice");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it("provider embeds a batch", async () => {
    const out = await new LexicalEmbeddingsProvider().embed(["x", "y"]);
    expect(out).toHaveLength(2);
    expect(out[0]!.length).toBe(4096);
  });
});

describe("ollama embeddings provider", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses neural embeddings when the model responds", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embeddings: [[3, 4], [0, 1]] }) });
    const out = await new OllamaEmbeddingsProvider({ LOCAL_EMBED_MODEL: "nomic-embed-text" } as never).embed(["a", "b"]);
    // Returned normalized.
    expect(Math.hypot(out[0]![0]!, out[0]![1]!)).toBeCloseTo(1);
  });

  it("self-falls-back to lexical when the model doesn't support embeddings", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "this model does not support embeddings" }) });
    const out = await new OllamaEmbeddingsProvider({} as never).embed(["renewal date"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBe(4096); // lexical dim → fell back, didn't throw
  });
});
