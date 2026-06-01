/**
 * Model-tier leaderboard (Phase 1, F2) — accuracy × latency across local models.
 *
 * Runs the extraction benchmark over the SAME held-out corpus for each installed
 * model and prints a comparison so we can pick the right tier per surface: the
 * strongest model for the brief, the cheapest model that still clears the bar for
 * the latency-sensitive Ask panel.
 *
 * Run (each model must be pulled in Ollama):
 *   pnpm ai:leaderboard
 *   LEADERBOARD_MODELS=qwen3.6:latest,qwen3.5:9b,qwen3.5:4b BENCH_COUNT=8 pnpm ai:leaderboard
 *
 * Output: docs/product/ai-eval/leaderboard.{md,json}.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LocalLlmClient } from "@server/infrastructure/ai/local-llm/client";
import { LocalLlmExtractionProvider } from "@server/infrastructure/ai/local-llm/extraction-provider";
import { generateCorpus } from "@server/infrastructure/ai/eval/corpus";
import { scoreCorpus } from "@server/infrastructure/ai/eval/score";
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
  console.log(`Model-tier leaderboard — ${models.length} models × ${count} held-out contracts\n`);

  const rows: Row[] = [];
  for (const model of models) {
    const provider = new LocalLlmExtractionProvider(new LocalLlmClient({ model }));
    const items: Array<{ contract: GoldenContract; result: ExtractionResult }> = [];
    let totalMs = 0;
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
    const row: Row = {
      model,
      f1: report.overall.f1,
      ece: report.ece,
      hallucinationEscapes: report.hallucinationEscapes,
      injectionEscapes: report.injectionEscapes,
      avgLatencyMs: Math.round(totalMs / corpus.length),
    };
    rows.push(row);
    console.log(` F1 ${(row.f1 * 100).toFixed(1)}%  ${row.avgLatencyMs}ms/doc  esc ${row.hallucinationEscapes}/${row.injectionEscapes}`);
  }

  rows.sort((a, b) => b.f1 - a.f1 || a.avgLatencyMs - b.avgLatencyMs);
  const strongest = rows[0];
  const cheapestPassing = [...rows]
    .filter((r) => r.f1 >= 0.9 && r.hallucinationEscapes === 0 && r.injectionEscapes === 0)
    .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];

  console.log("\n──────── LEADERBOARD ────────");
  console.log(`brief surface (accuracy-first):   ${strongest?.model} (F1 ${((strongest?.f1 ?? 0) * 100).toFixed(1)}%)`);
  console.log(`Ask surface (latency-first, ≥0.9): ${cheapestPassing?.model ?? "none cleared 0.9"}${cheapestPassing ? ` (${cheapestPassing.avgLatencyMs}ms/doc)` : ""}`);

  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "leaderboard.json"), JSON.stringify({ seed, count, rows }, null, 2));
  writeFileSync(
    path.join(outDir, "leaderboard.md"),
    [
      `# Model-Tier Leaderboard (extraction)`,
      ``,
      `Held-out corpus (seed ${seed}, ${count} contracts). Pick the strongest model`,
      `for the brief; the cheapest model clearing F1≥0.9 with 0 escapes for the`,
      `latency-sensitive Ask panel.`,
      ``,
      `| Model | F1 | ECE | Hallucination esc | Injection esc | Latency/doc |`,
      `| --- | --- | --- | --- | --- | --- |`,
      ...rows.map((r) => `| ${r.model} | ${(r.f1 * 100).toFixed(1)}% | ${r.ece} | ${r.hallucinationEscapes} | ${r.injectionEscapes} | ${r.avgLatencyMs}ms |`),
      ``,
      `**Recommendation:** brief → \`${strongest?.model}\`; Ask → \`${cheapestPassing?.model ?? "(none cleared 0.9)"}\`.`,
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(outDir, "leaderboard.md")} + .json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
