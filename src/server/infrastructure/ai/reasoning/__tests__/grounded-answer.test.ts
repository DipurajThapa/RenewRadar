/**
 * Grounded answer (P3-S1) — the deterministic answerQuestion + the validateAnswer
 * honesty gate. Pins: answers are built ONLY from facts, empty facts → honest
 * "no data", and the validator drops ungrounded / fabricated-quote claims.
 */
import { describe, expect, it } from "vitest";
import { DeterministicReasoningProvider } from "@server/infrastructure/ai/reasoning/deterministic-provider";
import { validateAnswer } from "@server/infrastructure/ai/reasoning/validate";
import type {
  GroundedAnswer,
  RetrievedFact,
} from "@server/infrastructure/ai/reasoning/types";

const provider = new DeterministicReasoningProvider();

const fact = (over: Partial<RetrievedFact>): RetrievedFact => ({
  source: "account_risk",
  detail: "1 renewal at high risk: Acme — Pro ($12,000/yr).",
  quote: null,
  refId: "sub-1",
  href: "/action-queue",
  ...over,
});

describe("DeterministicReasoningProvider.answerQuestion", () => {
  it("builds one grounded claim per fact, evidence = the fact", async () => {
    const facts = [
      fact({ detail: "Top risk: Acme — Pro.", href: "/action-queue" }),
      fact({
        source: "savings",
        detail: "Saved $5,000/yr YTD.",
        href: "/reports",
        refId: null,
      }),
    ];
    const ans = await provider.answerQuestion({
      question: "what's urgent?",
      facts,
    });
    expect(ans.answers).toHaveLength(2);
    expect(ans.answers[0]?.evidence[0]?.detail).toBe("Top risk: Acme — Pro.");
    expect(ans.answers.every((a) => a.evidence.length > 0)).toBe(true);
    expect(ans.summary).toContain("Acme");
    expect(ans.meta.engine).toBe("deterministic");
  });

  it("dedups deep-links across facts that share a screen", async () => {
    const facts = [
      fact({ href: "/action-queue" }),
      fact({ detail: "2nd risk", href: "/action-queue" }),
      fact({ source: "savings", detail: "savings", href: "/reports" }),
    ];
    const ans = await provider.answerQuestion({ question: "q", facts });
    const hrefs = ans.deepLinks.map((d) => d.href);
    expect(hrefs).toEqual(["/action-queue", "/reports"]);
  });

  it("labels each deep-link by its destination, not the fact source", async () => {
    // Repro of the duplicate-looking "Open Needs you" links: two account_risk
    // facts, one pointing at the queue and one at a subscription page. The
    // labels must differ and reflect where each link actually goes.
    const facts = [
      fact({ source: "account_risk", detail: "3 high-risk", href: "/action-queue" }),
      fact({
        source: "account_risk",
        detail: "Biggest risk: Acme — Pro.",
        href: "/subscriptions/sub-123",
        refId: "sub-123",
      }),
    ];
    const ans = await provider.answerQuestion({ question: "biggest risk?", facts });
    const labels = ans.deepLinks.map((d) => d.label);
    expect(labels).toEqual(["Open Needs you", "Open renewal"]);
    // no two links render the same visible label
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("returns an honest 'no data' answer for empty facts", async () => {
    const ans = await provider.answerQuestion({
      question: "what's the meaning of life?",
      facts: [],
    });
    expect(ans.answers).toEqual([]);
    expect(ans.summary.toLowerCase()).toContain("couldn't find");
    expect(ans.missingInfo.length).toBeGreaterThan(0);
  });
});

describe("validateAnswer", () => {
  const base = (answers: GroundedAnswer["answers"]): GroundedAnswer => ({
    meta: {
      provider: "x",
      model: "m",
      promptVersion: "1",
      confidencePct: 80,
      engine: "deterministic",
    },
    question: "q",
    summary: "s",
    answers,
    missingInfo: [],
    deepLinks: [],
  });

  it("drops claims with no evidence", () => {
    const out = validateAnswer(
      base([
        { statement: "grounded", engine: "deterministic", confidencePct: 90, evidence: [fact({})] },
        { statement: "ungrounded", engine: "deterministic", confidencePct: 90, evidence: [] },
      ]),
      { sourceTexts: [fact({}).detail] }
    );
    expect(out.answers).toHaveLength(1);
    expect(out.answers[0]?.statement).toBe("grounded");
  });

  it("drops a claim whose quote isn't a verbatim substring of the sources", () => {
    const out = validateAnswer(
      base([
        {
          statement: "fabricated quote",
          engine: "deterministic",
          confidencePct: 90,
          evidence: [fact({ quote: "this text was never in the source" })],
        },
      ]),
      { sourceTexts: ["the real source text"] }
    );
    expect(out.answers).toHaveLength(0);
  });

  it("re-stamps engine=llm when a surviving claim is llm", () => {
    const out = validateAnswer(
      base([
        { statement: "x", engine: "llm", confidencePct: 90, evidence: [fact({})] },
      ]),
      { sourceTexts: [fact({}).detail] }
    );
    expect(out.meta.engine).toBe("llm");
  });
});
