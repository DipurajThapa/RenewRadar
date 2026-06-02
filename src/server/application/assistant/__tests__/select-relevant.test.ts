/**
 * Scale-robust relevance selection (Phase A, neural-hardened). The separation gate
 * must behave identically whether scores sit on the lexical scale (unrelated ≈ 0)
 * or the neural scale (unrelated ≈ 0.4 baseline) — it keys on SEPARATION, not an
 * absolute cosine. Measured live: a real question separates ≈0.2, "weather?" ≈0.015.
 */
import { describe, expect, it } from "vitest";
import { selectRelevant } from "@server/application/assistant/semantic-retrieve";
import type { RetrievedFact } from "@server/infrastructure/ai/reasoning/types";

const fact = (detail: string): RetrievedFact => ({ source: "x", detail, quote: null, refId: null, href: null });
const rank = (pairs: Array<[string, number]>) =>
  pairs
    .map(([detail, score]) => ({ item: fact(detail), score }))
    .sort((a, b) => b.score - a.score);

describe("selectRelevant — separation gate", () => {
  it("LEXICAL scale: a clear standout is kept", () => {
    const ranked = rank([["high-risk renewals", 0.48], ["saved $3k", 0], ["soc2 expiry", 0], ["kpis", 0]]);
    const out = selectRelevant("anything risky?", ranked, { isNeural: false });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.detail).toContain("risk");
  });

  it("LEXICAL scale: a flat pool (nothing stands out) → [] (honest no-data)", () => {
    const ranked = rank([["a", 0.02], ["b", 0.01], ["c", 0], ["d", 0]]);
    expect(selectRelevant("weather?", ranked, { isNeural: false })).toEqual([]);
  });

  it("NEURAL (all-minilm) scale: an on-topic synonym question clears the floor", () => {
    // all-minilm measured: on-topic ~0.27–0.50, unrelated ~0.10. Floor 0.18.
    const ranked = rank([["high-risk renewals", 0.45], ["saved", 0.20], ["soc2", 0.19], ["kpis", 0.22]]);
    const out = selectRelevant("am I exposed?", ranked, { isNeural: true });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.detail).toContain("risk");
  });

  it("NEURAL (all-minilm) scale: an unrelated question (weather ≈0.10) → []", () => {
    // The shape measured live for "what's the weather in Tokyo?" with all-minilm.
    const ranked = rank([["renewals", 0.10], ["risk", 0.09], ["kpis", 0.08], ["savings", 0.10], ["compliance", 0.07]]);
    expect(selectRelevant("what's the weather?", ranked, { isNeural: true })).toEqual([]);
  });

  it("a tiny pool gates on an absolute floor and never answers from noise", () => {
    // An unrelated weak match (lexical ≈ 0) → dropped.
    expect(selectRelevant("weather?", rank([["compliance expiry", 0.02]]), { isNeural: false })).toEqual([]);
    // A near-identical match (lexical ≈ 0.6) → kept.
    expect(
      selectRelevant("compliance expiry?", rank([["compliance expiry", 0.6]]), { isNeural: false })[0]?.detail
    ).toContain("compliance");
  });
});
