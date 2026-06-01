/**
 * Reasoning benchmark (Phase 1, C3) — measures the brief WITHOUT grading itself.
 *
 * Each scenario's brief is produced by the system model (qwen3.6) and then judged
 * by a DIFFERENT model (default llama3.1-storm:8b) on grounding + reasonableness,
 * alongside deterministic rule checks. Independence is the point: a model can't
 * rubber-stamp its own output.
 *
 * Run (both models must be pulled in Ollama):
 *   pnpm ai:benchmark:reasoning
 *   JUDGE_MODEL=qwen3.5:9b pnpm ai:benchmark:reasoning
 *
 * Output: docs/product/ai-eval/reasoning-report.{md,json}; non-zero exit on miss.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getReasoningProvider,
  _resetReasoningProviderForTests,
} from "@server/infrastructure/ai";
import { LocalLlmClient } from "@server/infrastructure/ai/local-llm/client";
import {
  JUDGE_SYSTEM_PROMPT,
  aggregateReasoning,
  buildJudgeUser,
  parseJudgeVerdict,
  ruleCheck,
  type ReasoningEvalItem,
} from "@server/infrastructure/ai/eval/judge";
import { goldenBriefs } from "./golden";

const THRESHOLDS = {
  ruleAccuracyPct: 90,
  missedDeadlineOkPct: 100,
  groundingRatePct: 100,
  hallucinationEscapes: 0,
  judgePassRatePct: 85,
};

async function main() {
  if (
    process.env.AI_REASONING_PROVIDER !== "ollama" &&
    process.env.AI_REASONING_PROVIDER !== "local"
  ) {
    process.env.AI_REASONING_PROVIDER = "ollama";
  }
  _resetReasoningProviderForTests();

  const judgeModel = process.env.JUDGE_MODEL ?? "llama3.1-storm:8b";
  const systemClient = new LocalLlmClient();
  const judgeClient = new LocalLlmClient({ model: judgeModel });

  if (!(await systemClient.isReachable())) {
    console.error(`Ollama not reachable at ${systemClient.baseUrl}.`);
    process.exit(1);
  }

  const provider = getReasoningProvider();
  console.log(
    `Reasoning benchmark — system=${provider.model} judge=${judgeModel}\n` +
      `scenarios=${goldenBriefs.length}\n`
  );

  // Phase 1: produce all briefs with the system model (keeps it loaded).
  const briefs = [];
  for (const g of goldenBriefs) {
    const t0 = Date.now();
    const brief = await provider.buildBrief(g.input);
    console.log(
      `  brief  ${g.name.padEnd(34)} → ${brief.recommendedAction.padEnd(26)} ` +
        `(engine=${brief.meta.engine}, ${Date.now() - t0}ms)`
    );
    briefs.push({ g, brief });
  }

  // Phase 2: judge each brief with the INDEPENDENT model.
  console.log("");
  const items: ReasoningEvalItem[] = [];
  for (const { g, brief } of briefs) {
    const rule = ruleCheck(g.input, brief, g.acceptableActions);
    let judge;
    try {
      const raw = await judgeClient.chatJson({
        system: JUDGE_SYSTEM_PROMPT,
        user: buildJudgeUser(g.input, brief),
      });
      judge = parseJudgeVerdict(raw);
    } catch (err) {
      console.log(`  judge  ${g.name.padEnd(34)} → ERROR ${(err as Error)?.message}`);
      judge = parseJudgeVerdict({});
    }
    console.log(
      `  judge  ${g.name.padEnd(34)} → grounded=${judge.grounded} reasonable=${judge.reasonable} ` +
        `${judge.pass ? "PASS" : "fail"}  ${rule.actionAcceptable ? "" : "[action⚠]"}`
    );
    items.push({ rule, judge });
  }

  const report = aggregateReasoning(items);
  const pass =
    report.ruleAccuracyPct >= THRESHOLDS.ruleAccuracyPct &&
    report.missedDeadlineOkPct >= THRESHOLDS.missedDeadlineOkPct &&
    report.groundingRatePct >= THRESHOLDS.groundingRatePct &&
    report.hallucinationEscapes === THRESHOLDS.hallucinationEscapes &&
    report.judgePassRatePct >= THRESHOLDS.judgePassRatePct;

  console.log("\n──────── REASONING SCORE ────────");
  console.log(`rule accuracy          ${report.ruleAccuracyPct}%  [A+ ≥ ${THRESHOLDS.ruleAccuracyPct}%]`);
  console.log(`missed-deadline rule   ${report.missedDeadlineOkPct}%  [A+ = 100%]`);
  console.log(`grounding rate         ${report.groundingRatePct}%  [A+ = 100%]`);
  console.log(`hallucination escapes  ${report.hallucinationEscapes}  [A+ = 0]`);
  console.log(`engine=llm rate        ${report.engineLlmPct}%`);
  console.log(`independent-judge pass ${report.judgePassRatePct}%  [A+ ≥ ${THRESHOLDS.judgePassRatePct}%]  (avg grounded ${report.avgGrounded}, reasonable ${report.avgReasonable})`);
  console.log(`\nA+ VERDICT: ${pass ? "PASS ✅" : "REVIEW ⚠️"}`);

  const outDir = path.resolve("docs/product/ai-eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "reasoning-report.json"),
    JSON.stringify({ systemModel: provider.model, judgeModel, report }, null, 2)
  );
  writeFileSync(
    path.join(outDir, "reasoning-report.md"),
    [
      `# Reasoning Benchmark — system ${provider.model}, judge ${judgeModel}`,
      ``,
      `Briefs produced by the system model and scored by a DIFFERENT model + rule`,
      `checks (no self-grading).`,
      ``,
      `**A+ verdict: ${pass ? "PASS ✅" : "REVIEW ⚠️"}**`,
      ``,
      `| Metric | Value | A+ bar |`,
      `| --- | --- | --- |`,
      `| Rule accuracy | ${report.ruleAccuracyPct}% | ≥ ${THRESHOLDS.ruleAccuracyPct}% |`,
      `| Missed-deadline rule | ${report.missedDeadlineOkPct}% | 100% |`,
      `| Grounding rate | ${report.groundingRatePct}% | 100% |`,
      `| Hallucination escapes | ${report.hallucinationEscapes} | 0 |`,
      `| Independent-judge pass | ${report.judgePassRatePct}% | ≥ ${THRESHOLDS.judgePassRatePct}% |`,
      `| Avg grounded / reasonable | ${report.avgGrounded} / ${report.avgReasonable} | — |`,
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(outDir, "reasoning-report.md")} + .json`);

  if (!pass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
