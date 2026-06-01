/**
 * AI safety contract (Phase 2, E2 / E4 / E5).
 *
 *   E2 — the prompt-injection defense is PRESENT in every model prompt (so it
 *        can't be silently removed in a future edit).
 *   E4 — every AI output type carries its provenance (engine + confidence +
 *        evidence / evidenceQuote) — the no-hallucination contract, enforced.
 *   E5 — the AI reasoning/extraction modules perform NO external side-effects:
 *        they must not import email / billing / payment / CRM / notification
 *        infrastructure. Advisor-not-agent, enforced by tooling not convention.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeterministicReasoningProvider } from "../reasoning/deterministic-provider";
import { HeuristicStubProvider } from "../heuristic-stub-provider";
import type { RenewalBriefInput } from "../reasoning/types";

const AI_DIR = path.resolve("src/server/infrastructure/ai");
const read = (rel: string) => readFileSync(path.join(AI_DIR, rel), "utf8");

// ─── E2 — prompt-injection defense present ───────────────────────────────────

describe("prompt-injection defense (E2)", () => {
  it("the brief + Ask prompts treat signals/facts as DATA, not instructions", () => {
    const src = read("reasoning/ollama-provider.ts");
    // Both system prompts must carry the "data, not instructions" guard.
    const occurrences = (src.match(/DATA, not instructions/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("the extraction prompt marks the contract as UNTRUSTED + wraps it in markers", () => {
    const src = read("local-llm/extraction-provider.ts");
    expect(src).toMatch(/UNTRUSTED DATA, not instructions/);
    expect(src).toContain("<<CONTRACT>>");
    expect(src).toContain("<</CONTRACT>>");
  });
});

// ─── E4 — output-contract / provenance ───────────────────────────────────────

function sampleBriefInput(): RenewalBriefInput {
  return {
    accountId: "a",
    subscriptionId: "s",
    vendorName: "Acme",
    productName: "Pro",
    billingCycle: "annual",
    annualValueCents: 120_000,
    autoRenew: true,
    noticePeriodDays: 30,
    termEndDate: "2026-12-31",
    daysUntilNoticeDeadline: 12,
    noticeDeadlineMissed: false,
    hasPriceIncreaseClause: false,
    priceIncreaseClauseText: null,
    chargeHistory: [
      { effectiveDate: "2025-01-01", totalAnnualizedCents: 100_000, source: "term_start", refId: null },
      { effectiveDate: "2026-01-01", totalAnnualizedCents: 120_000, source: "spend_feed", refId: "t1" },
    ],
    benchmark: {
      sampleAccounts: 5,
      typicalNoticePeriodDays: 30,
      autoRenewRatePct: 70,
      medianAnnualValueCents: 100_000,
      topLevers: [{ lever: "competing_quote", count: 3 }],
      medianSavingsAnnualCents: 12_000,
    },
    priorDecisions: [],
  };
}

describe("output-contract / provenance (E4)", () => {
  const reasoner = new DeterministicReasoningProvider();

  it("every brief claim carries engine + integer confidence + evidence", async () => {
    const brief = await reasoner.buildBrief(sampleBriefInput());
    expect(["deterministic", "llm"]).toContain(brief.meta.engine);
    expect(brief.meta.briefVersion).toBeTruthy();
    expect(brief.claims.length).toBeGreaterThan(0);
    for (const c of brief.claims) {
      expect(["deterministic", "llm"]).toContain(c.engine);
      expect(Number.isInteger(c.confidencePct)).toBe(true);
      expect(c.confidencePct).toBeGreaterThanOrEqual(0);
      expect(c.confidencePct).toBeLessThanOrEqual(100);
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });

  it("every Ask answer carries engine + confidence + evidence, with missingInfo + deepLinks arrays", async () => {
    const ans = await reasoner.answerQuestion({
      question: "what's my risk?",
      facts: [
        { source: "account_risk", detail: "Biggest risk: Acme — Pro ($1,200/yr).", quote: null, refId: "s", href: "/action-queue" },
      ],
    });
    expect(["deterministic", "llm"]).toContain(ans.meta.engine);
    expect(Array.isArray(ans.missingInfo)).toBe(true);
    expect(Array.isArray(ans.deepLinks)).toBe(true);
    for (const a of ans.answers) {
      expect(["deterministic", "llm"]).toContain(a.engine);
      expect(Number.isInteger(a.confidencePct)).toBe(true);
      expect(a.evidence.length).toBeGreaterThan(0);
    }
  });

  it("every extracted field carries a non-empty evidenceQuote + integer confidence", async () => {
    const text =
      "The renewal date is 2026-12-31. Either party may cancel with 30 days written notice. " +
      "This shall automatically renew. Annual fee of $12,000 per year.";
    const res = await new HeuristicStubProvider().extract({ text });
    expect(res.fields.length).toBeGreaterThan(0);
    for (const f of res.fields) {
      expect(f.fieldKey).toBeTruthy();
      expect(f.evidenceQuote.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(f.confidencePct)).toBe(true);
      expect(f.confidencePct).toBeGreaterThanOrEqual(0);
      expect(f.confidencePct).toBeLessThanOrEqual(100);
    }
  });

  it("a brief/answer meta.usage block, when present, is well-formed (no negative billing)", async () => {
    const brief = await reasoner.buildBrief(sampleBriefInput());
    if (brief.meta.usage) {
      expect(Number.isInteger(brief.meta.usage.promptTokens)).toBe(true);
      expect(brief.meta.usage.promptTokens).toBeGreaterThanOrEqual(0);
      expect(brief.meta.usage.completionTokens).toBeGreaterThanOrEqual(0);
      expect(brief.meta.usage.costUsdMicros).toBeGreaterThanOrEqual(0);
    } else {
      // Deterministic path is free — no usage is the correct contract.
      expect(brief.meta.usage).toBeUndefined();
    }
  });

  // EVERY AI output type — including the narrative insight surface (risk
  // explainer / vendor intelligence / savings narrative) — must carry honest
  // provenance: provider + model + an integer 0..100 confidence. These narrate
  // over already-grounded structured data, so they carry meta provenance rather
  // than per-claim evidence — but they may NEVER ship without provenance.
  it("every insight-provider output carries provider + model + integer confidence", async () => {
    const insight = new HeuristicStubProvider();
    const outputs = [
      await insight.explainRisk({
        riskScore: 72, riskBand: "high",
        components: { urgency: 30, value: 25, clausePressure: 17 },
        daysUntilNoticeDeadline: 6, annualValueCents: 120_000, autoRenew: true,
        isMissed: false, vendorName: "Acme", productName: "Pro",
      }),
      await insight.summarizeVendorIntelligence({
        vendorName: "Acme", yearsTracked: 3, activeSubscriptions: 2, cancelledSubscriptions: 1,
        totalSavedAnnualCents: 30_000, averagePriceChangePct: 7, lastDecisionLabel: "renewed",
        lastDecisionDate: "2025-12-01", complianceArtifacts: 2, expiringComplianceArtifacts: 1,
      }),
      await insight.narrateSavings({
        vendorName: "Acme", productName: "Pro", kind: "negotiation",
        baselineAnnualUsdCents: 120_000, newAnnualUsdCents: 108_000, savedAnnualUsdCents: 12_000,
        negotiationLever: "competing_quote", rationaleCodes: ["price_increase"],
      }),
    ];
    for (const o of outputs) {
      expect(o.meta.provider).toBeTruthy();
      expect(o.meta.model).toBeTruthy();
      expect(Number.isInteger(o.meta.confidencePct)).toBe(true);
      expect(o.meta.confidencePct).toBeGreaterThanOrEqual(0);
      expect(o.meta.confidencePct).toBeLessThanOrEqual(100);
    }
  });
});

// ─── E5 — agent boundary (no external side-effects) ──────────────────────────

describe("agent boundary (E5)", () => {
  // Import-path fragments that would let the AI layer ACT on the world.
  const FORBIDDEN = [
    "/email",
    "infrastructure/billing",
    "stripe",
    "infrastructure/crm",
    "/notification", // notifications + notification-channel
    "EmailProvider",
    "sendEmail",
  ];

  function aiSourceFiles(): string[] {
    return readdirSync(AI_DIR, { recursive: true })
      .map((p) => String(p))
      .filter((p) => p.endsWith(".ts"))
      .filter((p) => !p.includes("__tests__"));
  }

  it("no AI reasoning/extraction module imports email/billing/payment/CRM/notification infra", () => {
    const offenders: string[] = [];
    for (const rel of aiSourceFiles()) {
      const src = read(rel);
      const importLines = src
        .split("\n")
        .filter((l) => /^\s*(import|const .* = require\()/.test(l));
      for (const line of importLines) {
        for (const bad of FORBIDDEN) {
          if (line.includes(bad)) offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
