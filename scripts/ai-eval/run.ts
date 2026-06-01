/**
 * AI reasoning eval (Gate 3) — measures the local LLM (qwen3.6) against the
 * deterministic baseline on the golden set, and proves the no-hallucination
 * gate actually holds.
 *
 * Run (Ollama must be up):
 *   pnpm exec dotenv -e .env.local -- tsx scripts/ai-eval/run.ts
 *   LOCAL_LLM_MODEL=qwen3.5:9b pnpm exec dotenv -e .env.local -- tsx scripts/ai-eval/run.ts
 *
 * Emits a console table + writes docs/product/ai-eval/report.{md,json}.
 *
 * Metrics:
 *   - llm_fired:        the model produced a grounded brief (vs degraded to det)
 *   - action_ok:        recommendation ∈ the scenario's defensible set
 *   - agree_with_det:   recommendation == deterministic recommendation
 *   - quote_escapes:    fabricated/clauseless quotes that survived (MUST be 0)
 *   - grounded_ev_rate: (Ask) answer evidence that maps to a provided fact
 *   - honest_no_data:   (Ask) empty-facts question answered honestly
 *   - latency_ms:       wall-clock per model brief
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DeterministicReasoningProvider } from "@server/infrastructure/ai/reasoning/deterministic-provider";
import { OllamaReasoningProvider } from "@server/infrastructure/ai/reasoning/ollama-provider";
import { LocalLlmClient } from "@server/infrastructure/ai/local-llm/client";
import { goldenAsks, goldenBriefs } from "./golden";

type BriefRow = {
  name: string;
  llmFired: boolean;
  action: string;
  actionOk: boolean;
  agreeWithDet: boolean;
  claims: number;
  quoteEscapes: number;
  confidence: number;
  latencyMs: number;
};

type AskRow = {
  name: string;
  expectGrounded: boolean;
  llmFired: boolean;
  answers: number;
  groundedEvRate: number; // 0..1
  honestNoData: boolean;
  latencyMs: number;
};

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

async function main() {
  const client = new LocalLlmClient();
  const up = await client.isReachable();
  if (!up) {
    console.error(
      `Ollama not reachable at ${client.baseUrl}. Start it (\`ollama serve\`) and pull ${client.model}.`
    );
    process.exit(1);
  }
  console.log(`Eval model: ${client.model} @ ${client.baseUrl}\n`);

  const det = new DeterministicReasoningProvider();
  const llm = new OllamaReasoningProvider(client);

  const briefRows: BriefRow[] = [];
  for (const g of goldenBriefs) {
    const detBrief = await det.buildBrief(g.input);
    const t0 = Date.now();
    const b = await llm.buildBrief(g.input);
    const latencyMs = Date.now() - t0;

    const clause = g.input.priceIncreaseClauseText ?? "";
    let quoteEscapes = 0;
    for (const c of b.claims) {
      for (const ev of c.evidence) {
        if (ev.quote != null && !clause.includes(ev.quote)) quoteEscapes++;
      }
    }

    const row: BriefRow = {
      name: g.name,
      llmFired: b.meta.engine === "llm",
      action: b.recommendedAction,
      actionOk: g.acceptableActions.includes(b.recommendedAction),
      agreeWithDet: b.recommendedAction === detBrief.recommendedAction,
      claims: b.claims.length,
      quoteEscapes,
      confidence: b.meta.confidencePct,
      latencyMs,
    };
    briefRows.push(row);
    console.log(
      `brief  ${g.name.padEnd(34)} fired=${row.llmFired ? "Y" : "n"} ` +
        `action=${row.action.padEnd(26)} ok=${row.actionOk ? "Y" : "N"} ` +
        `claims=${row.claims} escapes=${row.quoteEscapes} ${row.latencyMs}ms`
    );
  }

  const askRows: AskRow[] = [];
  for (const g of goldenAsks) {
    const t0 = Date.now();
    const a = await llm.answerQuestion(g.input);
    const latencyMs = Date.now() - t0;

    const factDetails = new Set(g.input.facts.map((f) => f.detail));
    let evTotal = 0;
    let evGrounded = 0;
    for (const ans of a.answers) {
      for (const ev of ans.evidence) {
        evTotal++;
        if (factDetails.has(ev.detail)) evGrounded++;
      }
    }
    const row: AskRow = {
      name: g.name,
      expectGrounded: g.expectGrounded,
      llmFired: a.meta.engine === "llm",
      answers: a.answers.length,
      groundedEvRate: evTotal === 0 ? (g.expectGrounded ? 0 : 1) : evGrounded / evTotal,
      honestNoData:
        !g.expectGrounded && a.answers.length === 0 && a.missingInfo.length > 0,
      latencyMs,
    };
    askRows.push(row);
    console.log(
      `ask    ${g.name.padEnd(34)} fired=${row.llmFired ? "Y" : "n"} ` +
        `answers=${row.answers} groundedEv=${Math.round(row.groundedEvRate * 100)}% ` +
        `honestNoData=${row.honestNoData ? "Y" : "-"} ${row.latencyMs}ms`
    );
  }

  // ── Aggregates ─────────────────────────────────────────────────────────────
  const nBrief = briefRows.length;
  const firedN = briefRows.filter((r) => r.llmFired).length;
  const actionOkN = briefRows.filter((r) => r.actionOk).length;
  const agreeN = briefRows.filter((r) => r.agreeWithDet).length;
  const totalEscapes = briefRows.reduce((s, r) => s + r.quoteEscapes, 0);
  const avgLatency = Math.round(
    briefRows.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, nBrief)
  );
  // Calibration: avg confidence on correct vs incorrect recommendations.
  const okConf = briefRows.filter((r) => r.actionOk).map((r) => r.confidence);
  const badConf = briefRows.filter((r) => !r.actionOk).map((r) => r.confidence);
  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;

  const askGroundedOk = askRows
    .filter((r) => r.expectGrounded)
    .every((r) => r.groundedEvRate >= 0.99);
  const askHonestOk = askRows
    .filter((r) => !r.expectGrounded)
    .every((r) => r.honestNoData);

  const summary = {
    model: client.model,
    briefs: nBrief,
    llmFiredRate: pct(firedN, nBrief),
    recommendationAcceptableRate: pct(actionOkN, nBrief),
    agreementWithDeterministic: pct(agreeN, nBrief),
    hallucinatedQuoteEscapes: totalEscapes, // MUST be 0
    avgLatencyMs: avgLatency,
    confidenceWhenCorrect: mean(okConf),
    confidenceWhenIncorrect: mean(badConf),
    askGroundedEvidenceOk: askGroundedOk,
    askHonestNoDataOk: askHonestOk,
  };

  console.log("\n──────── SUMMARY ────────");
  for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(32)} ${v}`);

  const verdictPass =
    totalEscapes === 0 && askGroundedOk && askHonestOk && firedN >= Math.ceil(nBrief * 0.5);
  console.log(`\nGATE-3 VERDICT: ${verdictPass ? "PASS" : "REVIEW"}`);
  console.log(
    "  (PASS = zero hallucinated quotes survived, Ask answers grounded, honest on no-data, model fired on ≥50% of briefs)"
  );

  // ── Write report ───────────────────────────────────────────────────────────
  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify({ summary, briefRows, askRows }, null, 2)
  );

  const md = [
    `# AI Reasoning Eval — ${client.model}`,
    ``,
    `Local-LLM reasoning measured against the deterministic baseline on the golden set.`,
    `This is the Gate-3 measurement: it proves the model is good enough to default-on,`,
    `and that the no-hallucination validator actually holds.`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} |`),
    ``,
    `**Gate-3 verdict: ${verdictPass ? "PASS ✅" : "REVIEW ⚠️"}**`,
    ``,
    `## Briefs`,
    ``,
    `| Scenario | LLM fired | Action | Acceptable | Agrees w/ det | Claims | Quote escapes | Conf | Latency |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...briefRows.map(
      (r) =>
        `| ${r.name} | ${r.llmFired ? "Y" : "n"} | ${r.action} | ${r.actionOk ? "✅" : "❌"} | ${r.agreeWithDet ? "Y" : "n"} | ${r.claims} | ${r.quoteEscapes} | ${r.confidence}% | ${r.latencyMs}ms |`
    ),
    ``,
    `## Ask`,
    ``,
    `| Scenario | Expect grounded | LLM fired | Answers | Grounded evidence | Honest no-data | Latency |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...askRows.map(
      (r) =>
        `| ${r.name} | ${r.expectGrounded ? "Y" : "n"} | ${r.llmFired ? "Y" : "n"} | ${r.answers} | ${Math.round(r.groundedEvRate * 100)}% | ${r.honestNoData ? "✅" : "—"} | ${r.latencyMs}ms |`
    ),
    ``,
  ].join("\n");
  writeFileSync(path.join(outDir, "report.md"), md);
  console.log(`\n✓ wrote ${path.join(outDir, "report.md")} + report.json`);

  if (!verdictPass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
