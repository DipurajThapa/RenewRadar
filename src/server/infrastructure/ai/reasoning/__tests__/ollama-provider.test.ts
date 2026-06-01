/**
 * OllamaReasoningProvider — the local-LLM reasoning path.
 *
 * These tests inject a fake client (no network), so they run offline in CI and
 * pin the trust contract:
 *   - a grounded LLM brief survives, stamped engine:"llm";
 *   - a fabricated clause quote is dropped by the shared validator;
 *   - when the validator strips ALL claims → fall back to deterministic;
 *   - transport failure / malformed JSON → fall back to deterministic;
 *   - the numeric prediction + Ask deep-links always come from the deterministic
 *     engine (the model can't invent a dollar figure or a URL);
 *   - answerQuestion mirrors the same guarantees.
 *
 * A separate, env-gated integration test (`RUN_LLM_INTEGRATION=1`) exercises the
 * REAL model so we can prove the path end-to-end on a machine with Ollama up.
 */
import { describe, expect, it, vi } from "vitest";
import { OllamaReasoningProvider } from "../ollama-provider";
import { LocalLlmClient } from "../../local-llm/client";
import type { LocalLlmClient as LocalLlmClientType } from "../../local-llm/client";
import type {
  QuestionInput,
  RenewalBriefInput,
  RetrievedFact,
} from "../types";

const CLAUSE =
  "Fees may increase by up to seven percent (7%) at each renewal term.";

function briefInput(
  over: Partial<RenewalBriefInput> = {}
): RenewalBriefInput {
  return {
    accountId: "acct-1",
    subscriptionId: "sub-1",
    vendorName: "Acme",
    productName: "Pro",
    billingCycle: "annual",
    annualValueCents: 90_000,
    autoRenew: true,
    noticePeriodDays: 30,
    termEndDate: "2026-12-31",
    daysUntilNoticeDeadline: 4,
    noticeDeadlineMissed: false,
    hasPriceIncreaseClause: true,
    priceIncreaseClauseText: CLAUSE,
    chargeHistory: [
      {
        effectiveDate: "2025-01-01",
        totalAnnualizedCents: 80_000,
        source: "term_start",
        refId: null,
      },
      {
        effectiveDate: "2026-01-01",
        totalAnnualizedCents: 90_000,
        source: "spend_feed",
        refId: "txn-1",
      },
    ],
    benchmark: null,
    priorDecisions: [],
    ...over,
  };
}

/** Build a provider whose client returns exactly `payload` (or throws `err`). */
function providerReturning(payload: unknown, err?: Error): OllamaReasoningProvider {
  const fake: Pick<LocalLlmClientType, "chatJson" | "model"> = {
    model: "qwen-test:latest",
    chatJson: vi.fn(async () => {
      if (err) throw err;
      return payload as never;
    }),
  };
  return new OllamaReasoningProvider(fake);
}

describe("OllamaReasoningProvider.buildBrief", () => {
  it("keeps a grounded LLM brief and stamps engine=llm", async () => {
    const provider = providerReturning({
      recommendedAction: "cancelled",
      claims: [
        {
          key: "renewal_risk",
          statement: "Notice deadline is 4 days out with no owner.",
          confidencePct: 88,
          evidence: [
            {
              source: "notice_deadline",
              detail: "4 days until the notice deadline.",
              quote: null,
              refId: null,
            },
          ],
        },
        {
          key: "recommended_action",
          statement: "Cancel before the deadline given low usage.",
          confidencePct: 80,
          evidence: [
            {
              source: "auto_renew_flag",
              detail: "Auto-renew is on.",
              quote: null,
              refId: null,
            },
          ],
        },
      ],
      predictedNextAnnualCents: null,
    });

    const brief = await provider.buildBrief(briefInput());

    expect(brief.meta.engine).toBe("llm");
    expect(brief.meta.model).toBe("qwen-test:latest");
    expect(brief.recommendedAction).toBe("cancelled");
    expect(brief.claims.length).toBe(2);
    expect(brief.claims.every((c) => c.engine === "llm")).toBe(true);
  });

  it("keeps a verbatim clause quote and drops a fabricated one", async () => {
    const realQuote = "seven percent (7%)";
    const provider = providerReturning({
      recommendedAction: "renewed_with_adjustments",
      claims: [
        {
          key: "leverage",
          statement: "Push back on the uplift clause.",
          confidencePct: 75,
          evidence: [
            {
              source: "price_increase_clause",
              detail: "Contract allows a 7% uplift.",
              quote: realQuote, // verbatim substring of CLAUSE → kept
              refId: null,
            },
          ],
        },
        {
          key: "benchmark_position",
          statement: "Fabricated: pays 50% above peers.",
          confidencePct: 70,
          evidence: [
            {
              source: "price_increase_clause",
              detail: "made up",
              quote: "fifty percent (50%) above market", // NOT in CLAUSE → drop
              refId: null,
            },
          ],
        },
      ],
      predictedNextAnnualCents: null,
    });

    const brief = await provider.buildBrief(briefInput());

    expect(brief.meta.engine).toBe("llm");
    expect(brief.claims.length).toBe(1);
    expect(brief.claims[0]?.key).toBe("leverage");
  });

  it("falls back to deterministic when the validator strips every claim", async () => {
    const provider = providerReturning({
      recommendedAction: "cancelled",
      claims: [
        {
          key: "benchmark_position",
          statement: "Ungrounded — no evidence.",
          confidencePct: 90,
          evidence: [], // dropped: no receipts
        },
        {
          key: "leverage",
          statement: "Fabricated quote only.",
          confidencePct: 90,
          evidence: [
            {
              source: "price_increase_clause",
              detail: "x",
              quote: "this text is not in the clause",
              refId: null,
            },
          ],
        },
      ],
      predictedNextAnnualCents: null,
    });

    const brief = await provider.buildBrief(briefInput());
    // Nothing grounded survived → proven deterministic engine, honestly stamped.
    expect(brief.meta.engine).toBe("deterministic");
  });

  it("falls back to deterministic on transport failure", async () => {
    const provider = providerReturning(null, new Error("ECONNREFUSED"));
    const brief = await provider.buildBrief(briefInput());
    expect(brief.meta.engine).toBe("deterministic");
  });

  it("forces 'deferred' when the notice deadline is missed (hard-fact guardrail)", async () => {
    // The model wrongly says "renewed"; a missed deadline is a fact, not a
    // judgment call, so the provider must override to "deferred".
    const provider = providerReturning({
      recommendedAction: "renewed",
      claims: [
        {
          key: "renewal_risk",
          statement: "Deadline already passed.",
          confidencePct: 80,
          evidence: [
            {
              source: "notice_deadline",
              detail: "Notice deadline was 12 days ago.",
              quote: null,
              refId: null,
            },
          ],
        },
      ],
      predictedNextAnnualCents: null,
    });
    const brief = await provider.buildBrief(
      briefInput({ noticeDeadlineMissed: true, daysUntilNoticeDeadline: -12 })
    );
    expect(brief.meta.engine).toBe("llm");
    expect(brief.recommendedAction).toBe("deferred");
  });

  it("falls back to deterministic on malformed shape", async () => {
    const provider = providerReturning({ claims: "not-an-array" });
    const brief = await provider.buildBrief(briefInput());
    expect(brief.meta.engine).toBe("deterministic");
  });

  it("never lets the model set the predicted figure (numbers stay deterministic)", async () => {
    const deterministic = await providerReturning({
      claims: [],
    }).buildBrief(briefInput()); // deterministic fallback's prediction
    const provider = providerReturning({
      recommendedAction: "renewed",
      claims: [
        {
          key: "price_trajectory",
          statement: "Spend rose modestly.",
          confidencePct: 70,
          evidence: [
            {
              source: "charge_history",
              detail: "Annualized spend went $800 → $900.",
              quote: null,
              refId: "txn-1",
            },
          ],
        },
      ],
      // A malicious/hallucinated huge number — must be ignored.
      predictedNextAnnualCents: { point: 99_999_999, low: 1, high: 99_999_999 },
    });

    const brief = await provider.buildBrief(briefInput());
    expect(brief.meta.engine).toBe("llm");
    expect(brief.predictedNextAnnualCents).toEqual(
      deterministic.predictedNextAnnualCents
    );
  });
});

describe("OllamaReasoningProvider.answerQuestion", () => {
  const facts: RetrievedFact[] = [
    {
      source: "account_risk",
      detail: "Biggest risk: Acme — Pro ($900/yr), deadline in 4 days.",
      quote: null,
      refId: "sub-1",
      href: "/subscriptions/sub-1",
    },
  ];
  const question: QuestionInput = { question: "what's my biggest risk?", facts };

  it("keeps a grounded answer and borrows deterministic deep-links", async () => {
    const deterministic = await providerReturning({ answers: [] }).answerQuestion(
      question
    );
    const provider = providerReturning({
      summary: "Acme renews in 4 days.",
      answers: [
        {
          statement: "Your biggest risk is the Acme renewal in 4 days.",
          confidencePct: 85,
          evidence: [
            {
              source: "account_risk",
              detail: "Biggest risk: Acme — Pro ($900/yr), deadline in 4 days.",
              quote: null,
              refId: "sub-1",
              href: "/subscriptions/sub-1",
            },
          ],
        },
      ],
      missingInfo: [],
      deepLinks: [{ label: "FAKE", href: "/evil" }], // must be ignored
    });

    const ans = await provider.answerQuestion(question);
    expect(ans.meta.engine).toBe("llm");
    expect(ans.answers.length).toBe(1);
    // Deep-links come from the deterministic engine, never the model.
    expect(ans.deepLinks).toEqual(deterministic.deepLinks);
    expect(ans.deepLinks.some((d) => d.href === "/evil")).toBe(false);
  });

  it("falls back to deterministic when the LLM grounds nothing", async () => {
    const provider = providerReturning({
      summary: "x",
      answers: [
        {
          statement: "ungrounded",
          confidencePct: 90,
          evidence: [], // dropped
        },
      ],
      missingInfo: [],
    });
    const ans = await provider.answerQuestion(question);
    expect(ans.meta.engine).toBe("deterministic");
  });

  it("falls back to deterministic on transport failure", async () => {
    const provider = providerReturning(null, new Error("timeout"));
    const ans = await provider.answerQuestion(question);
    expect(ans.meta.engine).toBe("deterministic");
  });
});

// ── Live integration (opt-in) ────────────────────────────────────────────────
// Runs ONLY with RUN_LLM_INTEGRATION=1 and a reachable Ollama. Proves the real
// model produces a validated, grounded brief through the actual seam.
describe.runIf(process.env.RUN_LLM_INTEGRATION === "1")(
  "OllamaReasoningProvider (live)",
  () => {
    it(
      "produces a validated brief from the real model",
      async () => {
        const client = new LocalLlmClient();
        const reachable = await client.isReachable();
        if (!reachable) {
          // Soft skip: server not up even though the flag was set.
          return;
        }
        const provider = new OllamaReasoningProvider(client);
        const brief = await provider.buildBrief(briefInput());
        // Either the model grounded a claim (engine llm) or it degraded to
        // deterministic — both are valid; neither may be empty/ungrounded.
        expect(["llm", "deterministic"]).toContain(brief.meta.engine);
        expect(brief.claims.every((c) => c.evidence.length > 0)).toBe(true);
        expect(brief.recommendedAction).toBeTruthy();
      },
      300_000
    );
  }
);
