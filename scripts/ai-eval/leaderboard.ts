/**
 * Model-tier leaderboard (Phase 1 F2 + Phase 6 F2) — accuracy × latency × COST
 * across local models.
 *
 * Runs the extraction benchmark over the SAME held-out corpus for each installed
 * model and prints a comparison so we can pick the right tier per surface: the
 * strongest model for the brief, the cheapest model that still clears the bar for
 * the latency-sensitive Ask panel. The cost column prices each model's real token
 * usage at a hosted-equivalent rate (COST_*_PER_1K) so "cheap" is a number, not a
 * vibe — local inference is free, but this is what serving each tier WOULD cost.
 *
 * Run (each model must be pulled in Ollama):
 *   pnpm ai:leaderboard
 *   LEADERBOARD_MODELS=qwen3.6:latest,qwen3.5:9b,qwen3.5:4b BENCH_COUNT=8 pnpm ai:leaderboard
 *   COST_INPUT_PER_1K=0.0002 COST_OUTPUT_PER_1K=0.0006 pnpm ai:leaderboard
 *
 * Output: docs/product/ai-eval/leaderboard.{md,json}.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LocalLlmClient } from "@server/infrastructure/ai/local-llm/client";
import { LocalLlmExtractionProvider } from "@server/infrastructure/ai/local-llm/extraction-provider";
import { generateCorpus } from "@server/infrastructure/ai/eval/corpus";
import { scoreCorpus } from "@server/infrastructure/ai/eval/score";
import {
  estimateCostUsdMicros,
  formatUsd,
  referencePricing,
  sharedMeter,
} from "@server/infrastructure/ai/local-llm/usage";
import type { ExtractionResult } from "@server/infrastructure/ai/types";
import type { GoldenContract } from "@server/infrastructure/ai/eval/types";

const DEFAULT_MODELS = [
  "qwen3.6:latest",
  "qwen3.5:9b",
  "qwen3.5:4b",
  "llama3.1-storm:8b",
];

type Row = {
  model: string;
  f1: number;
  ece: number;
  hallucinationEscapes: number;
  injectionEscapes: number;
  avgLatencyMs: number;
  avgTokensPerDoc: number;
  costPerDocUsdMicros: number;
  costPer1kDocsUsdMicros: number;
};

async function main() {
  const models = (process.env.LEADERBOARD_MODELS?.split(",").map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_MODELS;
  const seed = Number(process.env.BENCH_SEED ?? 20260601);
  const count = Number(process.env.BENCH_COUNT ?? 8);

  if (!(await new LocalLlmClient().isReachable())) {
    console.error("Ollama not reachable.");
    process.exit(1);
  }

  const corpus = generateCorpus(seed, count);
  const pricing = referencePricing();
  console.log(
    `Model-tier leaderboard — ${models.length} models × ${count} held-out contracts ` +
      `(cost @ ${formatUsd(pricing.inputPer1kUsdMicros, 5)}/1k in, ${formatUsd(pricing.outputPer1kUsdMicros, 5)}/1k out)\n`
  );

  const rows: Row[] = [];
  for (const model of models) {
    const provider = new LocalLlmExtractionProvider(new LocalLlmClient({ model }));
    const items: Array<{ contract: GoldenContract; result: ExtractionResult }> = [];
    let totalMs = 0;
    sharedMeter.reset(); // meter only THIS model's real token usage
    process.stdout.write(`  ${model.padEnd(22)} `);
    for (const contract of corpus) {
      const t0 = Date.now();
      let result: ExtractionResult;
      try {
        result = await provider.extract({ text: contract.text, pageCount: 1 });
      } catch {
        result = { meta: { provider: "err", model, promptVersion: "x", costUsdMicros: 0, pagesCharged: 1 }, fields: [] };
      }
      totalMs += Date.now() - t0;
      items.push({ contract, result });
      process.stdout.write(".");
    }
    const report = scoreCorpus(items);
    const usage = sharedMeter.stats();
    // Price this model's measured tokens at the hosted-equivalent rate.
    const totalCostUsdMicros = estimateCostUsdMicros(
      { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens },
      pricing
    );
    const costPerDocUsdMicros = Math.round(totalCostUsdMicros / corpus.length);
    const row: Row = {
      model,
      f1: report.overall.f1,
      ece: report.ece,
      hallucinationEscapes: report.hallucinationEscapes,
      injectionEscapes: report.injectionEscapes,
      avgLatencyMs: Math.round(totalMs / corpus.length),
      avgTokensPerDoc: Math.round(usage.totalTokens / corpus.length),
      costPerDocUsdMicros,
      costPer1kDocsUsdMicros: costPerDocUsdMicros * 1000,
    };
    rows.push(row);
    console.log(
      ` F1 ${(row.f1 * 100).toFixed(1)}%  ${row.avgLatencyMs}ms/doc  ${row.avgTokensPerDoc}tok  ` +
        `${formatUsd(row.costPer1kDocsUsdMicros, 2)}/1k docs  esc ${row.hallucinationEscapes}/${row.injectionEscapes}`
    );
  }

  rows.sort((a, b) => b.f1 - a.f1 || a.avgLatencyMs - b.avgLatencyMs);
  const strongest = rows[0];
  const passing = rows.filter(
    (r) => r.f1 >= 0.9 && r.hallucinationEscapes === 0 && r.injectionEscapes === 0
  );
  const cheapestPassing = [...passing].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  // F2 — best $/doc among models that clear the quality bar (the value pick).
  const bestValue = [...passing].sort(
    (a, b) => a.costPerDocUsdMicros - b.costPerDocUsdMicros || a.avgLatencyMs - b.avgLatencyMs
  )[0];

  console.log("\n──────── LEADERBOARD ────────");
  console.log(`brief surface (accuracy-first):   ${strongest?.model} (F1 ${((strongest?.f1 ?? 0) * 100).toFixed(1)}%)`);
  console.log(`Ask surface (latency-first, ≥0.9): ${cheapestPassing?.model ?? "none cleared 0.9"}${cheapestPassing ? ` (${cheapestPassing.avgLatencyMs}ms/doc)` : ""}`);
  console.log(`best value (cost-first, ≥0.9):     ${bestValue?.model ?? "none cleared 0.9"}${bestValue ? ` (${formatUsd(bestValue.costPer1kDocsUsdMicros, 2)}/1k docs)` : ""}`);

  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "leaderboard.json"),
    JSON.stringify(
      {
        seed,
        count,
        pricing,
        recommendation: { brief: strongest?.model, ask: cheapestPassing?.model, value: bestValue?.model },
        rows,
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(outDir, "leaderboard.md"),
    [
      `# Model-Tier Leaderboard (extraction) — accuracy × latency × cost`,
      ``,
      `Held-out corpus (seed ${seed}, ${count} contracts). Pick the strongest model`,
      `for the brief; the cheapest model clearing F1≥0.9 with 0 escapes for the`,
      `latency-sensitive Ask panel. Cost prices each model's measured token usage at`,
      `${formatUsd(pricing.inputPer1kUsdMicros, 5)}/1k input + ${formatUsd(pricing.outputPer1kUsdMicros, 5)}/1k output`,
      `(hosted-equivalent — local inference is free; override via COST_*_PER_1K).`,
      ``,
      `| Model | F1 | ECE | Halluc. esc | Inj. esc | Latency/doc | Tokens/doc | $/1k docs |`,
      `| --- | --- | --- | --- | --- | --- | --- | --- |`,
      ...rows.map(
        (r) =>
          `| ${r.model} | ${(r.f1 * 100).toFixed(1)}% | ${r.ece} | ${r.hallucinationEscapes} | ${r.injectionEscapes} | ${r.avgLatencyMs}ms | ${r.avgTokensPerDoc} | ${formatUsd(r.costPer1kDocsUsdMicros, 2)} |`
      ),
      ``,
      `**Recommendation:** brief → \`${strongest?.model}\` (accuracy-first); ` +
        `Ask → \`${cheapestPassing?.model ?? "(none cleared 0.9)"}\` (latency-first); ` +
        `best value → \`${bestValue?.model ?? "(none cleared 0.9)"}\` (cost-first).`,
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(outDir, "leaderboard.md")} + .json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
