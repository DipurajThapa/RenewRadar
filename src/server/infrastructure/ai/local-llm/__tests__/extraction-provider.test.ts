/**
 * LocalLlmExtractionProvider — local-LLM contract extraction.
 *
 * Offline tests (injected fake client) pin the no-hallucination contract:
 *   - a field with a VERBATIM evidence quote survives;
 *   - a field whose quote is NOT in the source text is dropped;
 *   - a malformed value (bad date, out-of-range days) is dropped;
 *   - transport failure falls back to the heuristic extractor;
 *   - insights delegate to the deterministic heuristic engine.
 */
import { describe, expect, it, vi } from "vitest";
import { LocalLlmExtractionProvider } from "../extraction-provider";
import type { LocalLlmClient } from "../client";

const CONTRACT = [
  "MASTER SUBSCRIPTION AGREEMENT",
  "The term ends on 2026-12-31 and renews automatically.",
  "Either party may cancel with 30 days written notice.",
  "Annual fee of $1,200 per year.",
].join("\n");

function providerReturning(payload: unknown, err?: Error): LocalLlmExtractionProvider {
  const fake: Pick<LocalLlmClient, "chatJson" | "model"> = {
    model: "qwen-test:latest",
    chatJson: vi.fn(async () => {
      if (err) throw err;
      return payload as never;
    }),
  };
  return new LocalLlmExtractionProvider(fake);
}

describe("LocalLlmExtractionProvider.extract", () => {
  it("keeps fields with verbatim evidence and correct shapes", async () => {
    const provider = providerReturning({
      fields: [
        {
          fieldKey: "renewal_date",
          parsedValueJson: { date: "2026-12-31" },
          confidencePct: 95,
          evidenceQuote: "The term ends on 2026-12-31",
        },
        {
          fieldKey: "notice_period_days",
          parsedValueJson: { days: 30 },
          confidencePct: 92,
          evidenceQuote: "cancel with 30 days written notice",
        },
      ],
    });

    const res = await provider.extract({ text: CONTRACT });
    expect(res.meta.provider).toBe("ollama-extractor");
    expect(res.fields).toHaveLength(2);
    expect(res.fields.every((f) => CONTRACT.includes(f.evidenceQuote))).toBe(true);
    const notice = res.fields.find((f) => f.fieldKey === "notice_period_days");
    expect(notice?.parsedValueJson).toEqual({ days: 30 });
  });

  it("drops a field whose evidence quote is not in the source text", async () => {
    const provider = providerReturning({
      fields: [
        {
          fieldKey: "auto_renewal",
          parsedValueJson: { yes: true },
          confidencePct: 90,
          evidenceQuote: "this exact sentence is not in the contract",
        },
      ],
    });
    const res = await provider.extract({ text: CONTRACT });
    expect(res.fields).toHaveLength(0); // fabricated evidence → dropped
  });

  it("drops a malformed value (bad date / out-of-range days)", async () => {
    const provider = providerReturning({
      fields: [
        {
          fieldKey: "renewal_date",
          parsedValueJson: { date: "Dec 31 2026" }, // not YYYY-MM-DD
          confidencePct: 80,
          evidenceQuote: "The term ends on 2026-12-31",
        },
        {
          fieldKey: "notice_period_days",
          parsedValueJson: { days: 9999 }, // out of range
          confidencePct: 80,
          evidenceQuote: "30 days written notice",
        },
      ],
    });
    const res = await provider.extract({ text: CONTRACT });
    expect(res.fields).toHaveLength(0);
  });

  it("falls back to the heuristic extractor on transport failure", async () => {
    const provider = providerReturning(null, new Error("ECONNREFUSED"));
    const res = await provider.extract({ text: CONTRACT });
    // Heuristic regex picks up the ISO renewal date + notice period from CONTRACT.
    expect(res.meta.provider).toBe("heuristic-stub");
    expect(res.fields.length).toBeGreaterThan(0);
  });

  it("delegates insights to the deterministic heuristic engine", async () => {
    const provider = providerReturning({ fields: [] });
    const out = await provider.explainRisk({
      riskScore: 80,
      riskBand: "high",
      components: { urgency: 60, value: 30, clausePressure: 10 },
      daysUntilNoticeDeadline: 5,
      annualValueCents: 120_000,
      autoRenew: true,
      isMissed: false,
      vendorName: "Acme",
      productName: "Pro",
    });
    expect(out.meta.provider).toBe("heuristic-stub");
    expect(out.headline.length).toBeGreaterThan(0);
  });
});
