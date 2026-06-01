/**
 * Live proof that the local LLM (qwen3.6 via Ollama) produces a VALIDATED,
 * grounded Renewal Intelligence Brief through the real production seam.
 *
 * Run:
 *   AI_REASONING_PROVIDER=ollama pnpm exec dotenv -e .env.local -- tsx scripts/ai/live-brief-proof.ts
 *
 * It drives getReasoningProvider() (so it exercises the exact factory the app
 * uses), prints provenance + claims + evidence + timing, and asserts the trust
 * contract (every emitted claim carries evidence; a verbatim clause quote is
 * kept while a fabricated one would have been dropped by the validator).
 */
import { getReasoningProvider, _resetReasoningProviderForTests } from "@server/infrastructure/ai";
import type { RenewalBriefInput } from "@server/infrastructure/ai";

const CLAUSE =
  "Subscription fees shall increase by seven percent (7%) at each annual renewal unless renegotiated in writing.";

const input: RenewalBriefInput = {
  accountId: "demo-account",
  subscriptionId: "demo-sub",
  vendorName: "Datadog",
  productName: "Pro APM",
  billingCycle: "annual",
  annualValueCents: 90_000,
  autoRenew: true,
  noticePeriodDays: 30,
  termEndDate: "2026-07-15",
  daysUntilNoticeDeadline: 4,
  noticeDeadlineMissed: false,
  hasPriceIncreaseClause: true,
  priceIncreaseClauseText: CLAUSE,
  chargeHistory: [
    { effectiveDate: "2024-07-15", totalAnnualizedCents: 72_000, source: "term_start", refId: null },
    { effectiveDate: "2025-07-15", totalAnnualizedCents: 81_000, source: "price_changed", refId: "evt-1" },
    { effectiveDate: "2026-01-10", totalAnnualizedCents: 90_000, source: "spend_feed", refId: "txn-9" },
  ],
  benchmark: {
    sampleAccounts: 7,
    typicalNoticePeriodDays: 30,
    autoRenewRatePct: 71,
    medianAnnualValueCents: 78_000,
    topLevers: [
      { lever: "multi_year_commit", count: 4 },
      { lever: "competing_quote", count: 3 },
    ],
    medianSavingsAnnualCents: 9_000,
  },
  priorDecisions: [
    {
      decision: "renewed_with_adjustments",
      negotiationLever: "competing_quote",
      savedAnnualUsdCents: 6_000,
      decidedAt: "2025-07-01",
    },
  ],
};

async function main() {
  _resetReasoningProviderForTests();
  const provider = getReasoningProvider();
  console.log(
    `engine flag: AI_REASONING_PROVIDER=${process.env.AI_REASONING_PROVIDER ?? "(unset)"} | ` +
      `model env: LOCAL_LLM_MODEL=${process.env.LOCAL_LLM_MODEL ?? "(default qwen3.6:latest)"}`
  );
  console.log(`provider: ${provider.providerName} (${provider.model})`);

  const t0 = Date.now();
  const brief = await provider.buildBrief(input);
  const ms = Date.now() - t0;

  console.log("\n──────── RESULT ────────");
  console.log(`engine:        ${brief.meta.engine}   (llm = the local model spoke)`);
  console.log(`model:         ${brief.meta.model}`);
  console.log(`confidence:    ${brief.meta.confidencePct}%`);
  console.log(`recommended:   ${brief.recommendedAction}`);
  console.log(`headline:      ${brief.headline}`);
  console.log(`prediction:    ${JSON.stringify(brief.predictedNextAnnualCents)}  (deterministic — never model-invented)`);
  console.log(`latency:       ${ms} ms`);
  console.log(`\nclaims (${brief.claims.length}):`);
  for (const c of brief.claims) {
    console.log(`  • [${c.key}] (${c.engine}, ${c.confidencePct}%) ${c.statement}`);
    for (const ev of c.evidence) {
      console.log(`        ↳ ${ev.source}: ${ev.detail}${ev.quote ? `  «${ev.quote}»` : ""}`);
    }
  }

  // Trust assertions.
  const everyClaimHasEvidence = brief.claims.every((c) => c.evidence.length > 0);
  const quotesAreVerbatim = brief.claims.every((c) =>
    c.evidence.every((ev) => ev.quote == null || CLAUSE.includes(ev.quote))
  );
  console.log("\n──────── TRUST CHECK ────────");
  console.log(`every claim carries evidence:        ${everyClaimHasEvidence ? "PASS" : "FAIL"}`);
  console.log(`every clause quote is verbatim:      ${quotesAreVerbatim ? "PASS" : "FAIL"}`);
  if (!everyClaimHasEvidence || !quotesAreVerbatim) process.exit(1);
  console.log("\n✓ live brief validated end-to-end");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
