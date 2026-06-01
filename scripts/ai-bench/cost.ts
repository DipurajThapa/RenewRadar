/**
 * Unit-economics report (Phase 6, F1/F4) — turns real token usage into dollars.
 *
 * Local inference is free, but a production-served model is billed per token. This
 * runs real reasoning ops through the live model, meters the actual prompt +
 * completion tokens, prices them at a hosted-equivalent rate, and reports:
 *   • $/op + tokens/op for the reasoning (brief) surface
 *   • a monthly cost projection at a configurable op volume (local vs hosted)
 *   • cache savings — a warm second pass over identical inputs should be 100%
 *     cache hits, so its cost is $0 (F4: caching as a cost lever, measured)
 *
 * This is how we prove the economics are KNOWN — not guessed — before buying any
 * hosted capacity. Run:
 *   pnpm ai:cost
 *   COST_INPUT_PER_1K=0.0002 COST_OUTPUT_PER_1K=0.0006 COST_MONTHLY_OPS=50000 pnpm ai:cost
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getReasoningProvider,
  _resetReasoningProviderForTests,
} from "@server/infrastructure/ai";
import {
  LocalLlmClient,
  getResponseCacheStats,
} from "@server/infrastructure/ai/local-llm/client";
import {
  estimateCostUsdMicros,
  formatUsd,
  referencePricing,
  sharedMeter,
} from "@server/infrastructure/ai/local-llm/usage";
import { goldenBriefs } from "../ai-eval/golden";

async function runBriefs(): Promise<{ ops: number; llmFired: number }> {
  const provider = getReasoningProvider();
  const limit = Number(process.env.COST_OPS ?? goldenBriefs.length);
  const jobs = Array.from({ length: limit }, (_, i) => goldenBriefs[i % goldenBriefs.length]!);
  let llmFired = 0;
  for (const g of jobs) {
    const brief = await provider.buildBrief(g.input);
    if (brief.meta.engine === "llm") llmFired++;
  }
  return { ops: jobs.length, llmFired };
}

async function main() {
  // Force the LLM reasoning path with caching ON (so the warm pass can hit).
  if (
    process.env.AI_REASONING_PROVIDER !== "ollama" &&
    process.env.AI_REASONING_PROVIDER !== "local"
  ) {
    process.env.AI_REASONING_PROVIDER = "ollama";
  }
  process.env.LLM_CACHE_ENABLED = "true";
  _resetReasoningProviderForTests();

  if (!(await new LocalLlmClient().isReachable())) {
    console.error("Ollama not reachable.");
    process.exit(1);
  }

  const pricing = referencePricing();
  const provider = getReasoningProvider();
  console.log(
    `Cost report — provider=${provider.providerName} model=${provider.model}\n` +
      `pricing: ${formatUsd(pricing.inputPer1kUsdMicros, 5)}/1k input, ` +
      `${formatUsd(pricing.outputPer1kUsdMicros, 5)}/1k output (hosted-equivalent)\n`
  );

  // ── Pass A (cold): real model calls, metered. ────────────────────────────
  sharedMeter.reset();
  const cacheBefore = getResponseCacheStats();
  process.stdout.write("cold pass  ");
  const cold = await runBriefs();
  process.stdout.write("done\n");
  const coldMeter = sharedMeter.stats();
  const cacheAfterCold = getResponseCacheStats();
  const coldCostUsdMicros = estimateCostUsdMicros(
    { promptTokens: coldMeter.promptTokens, completionTokens: coldMeter.completionTokens, totalTokens: coldMeter.totalTokens },
    pricing
  );
  const calls = coldMeter.calls;
  const avgCostPerOpUsdMicros = calls ? Math.round(coldCostUsdMicros / calls) : 0;
  const avgTokensPerOp = coldMeter.avgTokens;

  // ── Pass B (warm): identical inputs — should be 100% cache hits, $0. ──────
  process.stdout.write("warm pass  ");
  await runBriefs();
  process.stdout.write("done\n");
  const warmMeter = sharedMeter.stats();
  const cacheAfterWarm = getResponseCacheStats();
  const warmNewCalls = warmMeter.calls - coldMeter.calls; // ideally 0
  const warmHits = cacheAfterWarm.hits - cacheAfterCold.hits;
  const savedUsdMicros = warmHits * avgCostPerOpUsdMicros;

  // ── Monthly projection. ───────────────────────────────────────────────────
  const monthlyOps = Number(process.env.COST_MONTHLY_OPS ?? 10_000);
  const monthlyHostedUsdMicros = monthlyOps * avgCostPerOpUsdMicros;
  const hitRatePct = cacheAfterWarm.hitRatePct;
  const monthlyWithCacheUsdMicros = Math.round(monthlyHostedUsdMicros * (1 - hitRatePct / 100));

  const cacheWorks = warmNewCalls === 0 && warmHits >= cold.ops;
  const measured = calls > 0;
  const verdict = measured ? "PASS" : "REVIEW";

  console.log("\n──────── COST REPORT ────────");
  console.log(`reasoning ops (cold)   ${cold.ops}  (llm-fired ${cold.llmFired}, metered calls ${calls})`);
  console.log(`tokens / op            ${avgTokensPerOp}  (prompt ${coldMeter.promptTokens}, completion ${coldMeter.completionTokens} total)`);
  console.log(`cost / op (hosted-eq)  ${formatUsd(avgCostPerOpUsdMicros)}   (local: $0.000000)`);
  console.log(`cost / 1k ops          ${formatUsd(avgCostPerOpUsdMicros * 1000, 2)}`);
  console.log(`warm pass new calls    ${warmNewCalls}  (cache hits ${warmHits}, hit-rate ${hitRatePct}%)  →  cache ${cacheWorks ? "WORKS ✅" : "REVIEW ⚠️"}`);
  console.log(`cache savings (warm)   ${formatUsd(savedUsdMicros)}  (this run)`);
  console.log(`\nmonthly @ ${monthlyOps} ops`);
  console.log(`  local                $0.00`);
  console.log(`  hosted-equivalent    ${formatUsd(monthlyHostedUsdMicros, 2)}`);
  console.log(`  hosted + cache       ${formatUsd(monthlyWithCacheUsdMicros, 2)}  (at ${hitRatePct}% hit-rate)`);
  console.log(`\nECONOMICS: ${verdict}${measured ? " ✅" : " ⚠️ (no LLM calls metered)"}`);

  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  const report = {
    provider: provider.providerName,
    model: provider.model,
    pricing,
    cold: {
      ops: cold.ops,
      llmFired: cold.llmFired,
      meteredCalls: calls,
      promptTokens: coldMeter.promptTokens,
      completionTokens: coldMeter.completionTokens,
      avgTokensPerOp,
      avgCostPerOpUsdMicros,
      totalCostUsdMicros: coldCostUsdMicros,
    },
    warm: { newCalls: warmNewCalls, cacheHits: warmHits, savedUsdMicros, cacheWorks },
    cache: { ...cacheAfterWarm, beforeRun: cacheBefore },
    monthly: { ops: monthlyOps, localUsdMicros: 0, hostedUsdMicros: monthlyHostedUsdMicros, hostedWithCacheUsdMicros: monthlyWithCacheUsdMicros, hitRatePct },
    verdict,
  };
  writeFileSync(path.join(outDir, "cost-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    path.join(outDir, "cost-report.md"),
    [
      `# Unit Economics — ${provider.model}`,
      ``,
      `Real reasoning ops metered, priced at ${formatUsd(pricing.inputPer1kUsdMicros, 5)}/1k input +`,
      `${formatUsd(pricing.outputPer1kUsdMicros, 5)}/1k output (hosted-equivalent; local inference is free).`,
      ``,
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Tokens / op | ${avgTokensPerOp} |`,
      `| Cost / op (hosted-eq) | ${formatUsd(avgCostPerOpUsdMicros)} |`,
      `| Cost / 1k ops | ${formatUsd(avgCostPerOpUsdMicros * 1000, 2)} |`,
      `| Cache hit-rate (warm pass) | ${hitRatePct}% |`,
      `| Cache savings (this run) | ${formatUsd(savedUsdMicros)} |`,
      `| Monthly @ ${monthlyOps} ops — local | $0.00 |`,
      `| Monthly @ ${monthlyOps} ops — hosted | ${formatUsd(monthlyHostedUsdMicros, 2)} |`,
      `| Monthly @ ${monthlyOps} ops — hosted + cache | ${formatUsd(monthlyWithCacheUsdMicros, 2)} |`,
      `| Cache working | ${cacheWorks ? "✅" : "⚠️"} |`,
      `| Economics | ${verdict}${measured ? " ✅" : " ⚠️"} |`,
      ``,
      `**Read:** caching turns identical re-asks (e.g. regenerating an unchanged`,
      `brief) into $0 — the warm pass fired ${warmNewCalls} new model calls. A`,
      `per-account budget cap (\`checkBudget\`) bounds worst-case spend; over budget,`,
      `the deterministic engine serves for free.`,
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(outDir, "cost-report.md")} + .json`);
  if (!measured) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
