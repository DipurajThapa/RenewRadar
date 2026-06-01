/**
 * F3 plumbing — the Ollama reasoning provider must stamp per-call token usage on
 * the result `meta.usage`, INCLUDING when it discards the model output and serves
 * the deterministic fallback (a completed call still consumed tokens → bill it).
 * The application layer reads `meta.usage` to charge the per-account spend ledger.
 */
import { describe, expect, it, vi } from "vitest";
import { OllamaReasoningProvider } from "../ollama-provider";
import type { LocalLlmClient } from "../../local-llm/client";
import type { RenewalBriefInput, QuestionInput, RetrievedFact } from "../types";
import type { TokenUsage } from "../../local-llm/usage";

const USAGE: TokenUsage = { promptTokens: 640, completionTokens: 48, totalTokens: 688 };

function briefInput(over: Partial<RenewalBriefInput> = {}): RenewalBriefInput {
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
    hasPriceIncreaseClause: false,
    priceIncreaseClauseText: null,
    chargeHistory: [
      { effectiveDate: "2025-01-01", totalAnnualizedCents: 80_000, source: "term_start", refId: null },
      { effectiveDate: "2026-01-01", totalAnnualizedCents: 90_000, source: "spend_feed", refId: "txn-1" },
    ],
    benchmark: null,
    priorDecisions: [],
    ...over,
  };
}

/** A client that reports `usage` via onUsage, then returns `payload`. */
function clientWithUsage(payload: unknown): Pick<LocalLlmClient, "chatJson" | "model"> {
  return {
    model: "qwen-test:latest",
    chatJson: vi.fn(async (args: { onUsage?: (u: TokenUsage) => void }) => {
      args.onUsage?.(USAGE);
      return payload as never;
    }),
  };
}

describe("buildBrief usage stamping", () => {
  it("stamps meta.usage from a completed call on a grounded brief", async () => {
    const provider = new OllamaReasoningProvider(
      clientWithUsage({
        recommendedAction: "cancelled",
        claims: [
          {
            key: "recommended_action",
            statement: "Cancel before the deadline.",
            confidencePct: 80,
            evidence: [{ source: "auto_renew_flag", detail: "Auto-renew is on.", quote: null, refId: null }],
          },
        ],
      })
    );
    const brief = await provider.buildBrief(briefInput());
    expect(brief.meta.engine).toBe("llm");
    expect(brief.meta.usage?.promptTokens).toBe(640);
    expect(brief.meta.usage?.completionTokens).toBe(48);
    expect(typeof brief.meta.usage?.costUsdMicros).toBe("number");
  });

  it("still bills usage when the model output is discarded (fallback)", async () => {
    // Empty payload → no grounded claims → deterministic fallback served, but the
    // tokens were spent, so meta.usage must still be present.
    const provider = new OllamaReasoningProvider(clientWithUsage({}));
    const brief = await provider.buildBrief(briefInput());
    expect(brief.meta.engine).toBe("deterministic");
    expect(brief.meta.usage?.promptTokens).toBe(640);
  });

  it("does NOT stamp usage when the call never completed (timeout)", async () => {
    const failing: Pick<LocalLlmClient, "chatJson" | "model"> = {
      model: "qwen-test:latest",
      chatJson: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    const brief = await new OllamaReasoningProvider(failing).buildBrief(briefInput());
    expect(brief.meta.engine).toBe("deterministic");
    expect(brief.meta.usage).toBeUndefined();
  });
});

describe("answerQuestion usage stamping", () => {
  const facts: RetrievedFact[] = [
    { source: "account_risk", detail: "Acme renews in 12 days.", quote: null, refId: "sub-1", href: "/subscriptions/sub-1" },
  ];
  const input: QuestionInput = { question: "what renews soon?", facts };

  it("stamps meta.usage on a grounded answer", async () => {
    const provider = new OllamaReasoningProvider(
      clientWithUsage({
        summary: "Acme renews in 12 days.",
        answers: [
          {
            statement: "Acme renews in 12 days.",
            confidencePct: 75,
            evidence: [{ source: "account_risk", detail: "Acme renews in 12 days.", quote: null, refId: "sub-1", href: "/subscriptions/sub-1" }],
          },
        ],
        missingInfo: [],
      })
    );
    const answer = await provider.answerQuestion(input);
    expect(answer.meta.usage?.promptTokens).toBe(640);
  });
});
