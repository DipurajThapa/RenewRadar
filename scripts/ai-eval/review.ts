/**
 * One-command independent reviewer — `pnpm ai:review`.
 *
 * For a skeptical outsider (investor / auditor): run ONE command, watch it run
 * live, get a PASS/FAIL you can trust, plus a signed-by-provenance attestation.
 *
 * Why you can trust the verdict (it is built to resist being gamed):
 *   1. It PINS the models — qwen3.6 (system) + llama3.1-storm (judge) — so nobody
 *      can point the benchmark at a stronger/different model behind your back. The
 *      attestation records each model's digest.
 *   2. It DELETES stale reports before running, so it can only read fresh output.
 *   3. It RE-VALIDATES every number itself against the A+ thresholds — it does not
 *      trust the child scripts' own pass/fail.
 *   4. It verifies the reasoning judge is a DIFFERENT model than the writer
 *      (no self-grading).
 *   5. It stamps the git commit + working-tree cleanliness, so the result is tied
 *      to exact code.
 *
 * What it runs (≈ 7–9 min on a warm model):
 *   - typecheck (the code compiles)
 *   - the eval-logic unit tests (the F1/ECE/judge math is itself tested)
 *   - live brief proof  (qwen3.6 produces a validated, grounded brief via the real seam)
 *   - live extract proof (qwen3.6 extracts contract fields with verbatim evidence)
 *   - extraction benchmark (F1 / calibration / injection on a held-out corpus)
 *   - reasoning benchmark (brief scored by a DIFFERENT model + rule checks)
 *
 * Prereqs: Ollama running with `qwen3.6:latest` and `llama3.1-storm:8b` pulled.
 * Exit code is 0 ONLY if every check passes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
const SYSTEM_MODEL = "qwen3.6:latest";
const JUDGE_MODEL = "llama3.1-storm:8b";
const OUT_DIR = path.resolve("docs/product/ai-eval");
const TIMEOUT = "240000";

const THRESHOLDS = {
  extractionF1: 0.92,
  hardVariantF1: 0.8,
  ece: 0.05,
  reasoningRuleAccuracyPct: 90,
  reasoningJudgePassPct: 85,
};
const HARD_VARIANTS = new Set(["ocr_noise", "multilingual", "adversarial"]);

type Check = { name: string; what: string; ok: boolean; detail: string; ms?: number };
const checks: Check[] = [];
function record(c: Check) {
  checks.push(c);
  const mark = c.ok ? "✓ PASS" : "✗ FAIL";
  console.log(`\n[${mark}] ${c.name} — ${c.detail}\n`);
}

function sh(cmd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
}

/** Run a sub-command live (inherit stdio) with extra env; returns success. */
function runStep(
  name: string,
  what: string,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number
): boolean {
  console.log(`\n──────── ▶ ${name} ────────\n${what}\n`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    timeout: timeoutMs,
  });
  const ms = Date.now() - t0;
  const ok = r.status === 0 && !r.error;
  const detail = r.error
    ? `could not run (${r.error.message})`
    : r.signal
      ? `timed out / killed (${r.signal})`
      : `exit ${r.status} · ${(ms / 1000).toFixed(0)}s`;
  record({ name, what, ok, detail, ms });
  return ok;
}

function readJson(file: string): any | null {
  const p = path.join(OUT_DIR, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function ollamaTags(): Promise<Array<{ name: string; digest: string }> | null> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { models?: Array<{ name: string; digest?: string }> };
    return (j.models ?? []).map((m) => ({ name: m.name, digest: (m.digest ?? "").slice(0, 12) }));
  } catch {
    return null;
  }
}

async function main() {
  console.log(
    [
      "════════════════════════════════════════════════════════════",
      " Renewal Radar — independent AI reviewer",
      "════════════════════════════════════════════════════════════",
      " Verifies the AI is real and good ENOUGH on held-out data:",
      "   • the model runs through the real production seam",
      "   • extraction F1 + calibration + injection-resistance on a",
      "     held-out synthetic corpus, against fixed A+ thresholds",
      "   • the brief is judged by a DIFFERENT model (no self-grading)",
      " It pins the models, deletes stale reports, and re-checks every",
      " number itself — so the PASS/FAIL is not the scripts' word, it's",
      " this reviewer's independent verdict.",
      "════════════════════════════════════════════════════════════",
    ].join("\n")
  );

  // ── Provenance ────────────────────────────────────────────────────────────
  const sha = sh("git", ["rev-parse", "HEAD"]).out || "(unknown)";
  const dirty = sh("git", ["status", "--porcelain"]).out.length > 0;
  const node = process.version;
  console.log(`\ncommit: ${sha}${dirty ? "  ⚠ WORKING TREE DIRTY (uncommitted changes)" : "  (clean)"}`);
  console.log(`node:   ${node}`);
  console.log(`ollama: ${BASE}`);

  // ── Preflight: models present ─────────────────────────────────────────────
  const tags = await ollamaTags();
  if (!tags) {
    console.error(
      `\n✗ Ollama is not reachable at ${BASE}.\n  Start it:  ollama serve\n  Then pull: ollama pull ${SYSTEM_MODEL} && ollama pull ${JUDGE_MODEL}`
    );
    process.exit(1);
  }
  const haveSystem = tags.find((t) => t.name === SYSTEM_MODEL);
  const haveJudge = tags.find((t) => t.name === JUDGE_MODEL);
  if (!haveSystem || !haveJudge) {
    console.error(
      `\n✗ Required model(s) missing.\n` +
        `  system ${SYSTEM_MODEL}: ${haveSystem ? "ok" : "MISSING — ollama pull " + SYSTEM_MODEL}\n` +
        `  judge  ${JUDGE_MODEL}: ${haveJudge ? "ok" : "MISSING — ollama pull " + JUDGE_MODEL}`
    );
    process.exit(1);
  }
  console.log(
    `models: ${SYSTEM_MODEL} (#${haveSystem.digest})  judge ${JUDGE_MODEL} (#${haveJudge.digest})`
  );

  // Delete stale reports so we can only read FRESH output from this run.
  for (const f of ["extraction-report.json", "extraction-report.md", "reasoning-report.json", "reasoning-report.md"]) {
    rmSync(path.join(OUT_DIR, f), { force: true });
  }

  // ── Checks ────────────────────────────────────────────────────────────────
  runStep("typecheck", "the code under review compiles", "pnpm", ["typecheck"], {}, 180_000);

  runStep(
    "eval-logic-tests",
    "the F1 / ECE / judge math + provider guards are themselves unit-tested",
    "pnpm",
    [
      "exec", "dotenv", "-e", ".env.test", "--", "vitest", "run",
      "src/server/infrastructure/ai/eval",
      "src/server/infrastructure/ai/reasoning/__tests__/ollama-provider.test.ts",
      "src/server/infrastructure/ai/local-llm",
    ],
    {},
    180_000
  );

  runStep(
    "live-brief-proof",
    "qwen3.6 produces a validated, grounded brief through the REAL production seam",
    "pnpm",
    ["exec", "dotenv", "-e", ".env.local", "--", "tsx", "scripts/ai/live-brief-proof.ts"],
    { AI_REASONING_PROVIDER: "ollama", LOCAL_LLM_MODEL: SYSTEM_MODEL, LOCAL_LLM_TIMEOUT_MS: TIMEOUT },
    300_000
  );

  runStep(
    "live-extract-proof",
    "qwen3.6 extracts contract fields with VERBATIM evidence (no fabrication)",
    "pnpm",
    ["exec", "dotenv", "-e", ".env.local", "--", "tsx", "scripts/ai/live-extract-proof.ts"],
    { AI_EXTRACTION_PROVIDER: "ollama", LOCAL_LLM_MODEL: SYSTEM_MODEL, LOCAL_LLM_TIMEOUT_MS: TIMEOUT },
    300_000
  );

  runStep(
    "extraction-benchmark",
    "F1 / calibration / injection-resistance on a held-out synthetic corpus",
    "pnpm",
    ["ai:benchmark"],
    {
      LOCAL_LLM_MODEL: SYSTEM_MODEL,
      BENCH_COUNT: process.env.REVIEW_BENCH_COUNT ?? "16",
      LOCAL_LLM_TIMEOUT_MS: TIMEOUT,
    },
    900_000
  );

  runStep(
    "reasoning-benchmark",
    "the brief is scored by a DIFFERENT model (llama3.1-storm) + rule checks",
    "pnpm",
    ["ai:benchmark:reasoning"],
    { LOCAL_LLM_MODEL: SYSTEM_MODEL, JUDGE_MODEL, LOCAL_LLM_TIMEOUT_MS: TIMEOUT },
    900_000
  );

  // ── Independent re-validation of the numbers (don't trust, verify) ─────────
  const ext = readJson("extraction-report.json");
  if (!ext?.report) {
    record({ name: "extraction-numbers", what: "re-check extraction metrics", ok: false, detail: "no fresh report written" });
  } else {
    const r = ext.report;
    const hardOk = (r.perVariant ?? [])
      .filter((v: any) => HARD_VARIANTS.has(v.variant))
      .every((v: any) => v.prf.f1 >= THRESHOLDS.hardVariantF1);
    const ok =
      ext.model === SYSTEM_MODEL &&
      r.overall.f1 >= THRESHOLDS.extractionF1 &&
      hardOk &&
      r.ece <= THRESHOLDS.ece &&
      r.hallucinationEscapes === 0 &&
      r.injectionEscapes === 0;
    record({
      name: "extraction-numbers",
      what: "re-check extraction metrics against A+ thresholds + pinned model",
      ok,
      detail:
        `model=${ext.model} F1=${(r.overall.f1 * 100).toFixed(1)}% (≥${THRESHOLDS.extractionF1 * 100}) ` +
        `hardVariantsOk=${hardOk} ECE=${r.ece}(≤${THRESHOLDS.ece}) ` +
        `hallucEsc=${r.hallucinationEscapes} injEsc=${r.injectionEscapes}`,
    });
  }

  const rea = readJson("reasoning-report.json");
  if (!rea?.report) {
    record({ name: "reasoning-numbers", what: "re-check reasoning metrics", ok: false, detail: "no fresh report written" });
  } else {
    const r = rea.report;
    const independent = rea.systemModel === SYSTEM_MODEL && rea.judgeModel === JUDGE_MODEL && rea.judgeModel !== rea.systemModel;
    const ok =
      independent &&
      r.ruleAccuracyPct >= THRESHOLDS.reasoningRuleAccuracyPct &&
      r.missedDeadlineOkPct === 100 &&
      r.groundingRatePct === 100 &&
      r.hallucinationEscapes === 0 &&
      r.judgePassRatePct >= THRESHOLDS.reasoningJudgePassPct;
    record({
      name: "reasoning-numbers",
      what: "re-check reasoning metrics + judge INDEPENDENCE (different model)",
      ok,
      detail:
        `system=${rea.systemModel} judge=${rea.judgeModel} independent=${independent} ` +
        `ruleAcc=${r.ruleAccuracyPct}% grounding=${r.groundingRatePct}% ` +
        `hallucEsc=${r.hallucinationEscapes} judgePass=${r.judgePassRatePct}%(≥${THRESHOLDS.reasoningJudgePassPct})`,
    });
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const pass = checks.every((c) => c.ok);
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" REVIEW SCORECARD");
  console.log("════════════════════════════════════════════════════════════");
  for (const c of checks) {
    console.log(` ${c.ok ? "✓" : "✗"}  ${c.name.padEnd(22)} ${c.detail}`);
  }
  console.log("════════════════════════════════════════════════════════════");
  console.log(` VERDICT: ${pass ? "PASS ✅" : "FAIL ❌"}${dirty ? "  (note: working tree was dirty)" : ""}`);
  console.log("════════════════════════════════════════════════════════════");

  const attestation = {
    reviewedAt: new Date().toISOString(),
    verdict: pass ? "PASS" : "FAIL",
    gitCommit: sha,
    gitDirty: dirty,
    node,
    ollamaBaseUrl: BASE,
    systemModel: { name: SYSTEM_MODEL, digest: haveSystem.digest },
    judgeModel: { name: JUDGE_MODEL, digest: haveJudge.digest },
    thresholds: THRESHOLDS,
    checks,
    extractionReport: ext?.report ?? null,
    reasoningReport: rea?.report ?? null,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "review-attestation.json"), JSON.stringify(attestation, null, 2));
  writeFileSync(
    path.join(OUT_DIR, "REVIEW.md"),
    [
      `# Independent AI Review — ${pass ? "PASS ✅" : "FAIL ❌"}`,
      ``,
      `- Reviewed: ${attestation.reviewedAt}`,
      `- Commit: \`${sha}\`${dirty ? " ⚠ (working tree dirty)" : " (clean)"}`,
      `- System model: \`${SYSTEM_MODEL}\` (#${haveSystem.digest}) · Judge model: \`${JUDGE_MODEL}\` (#${haveJudge.digest})`,
      `- Node: ${node}`,
      ``,
      `| Check | Result | Detail |`,
      `| --- | --- | --- |`,
      ...checks.map((c) => `| ${c.name} | ${c.ok ? "✓ pass" : "✗ FAIL"} | ${c.detail} |`),
      ``,
      `Re-run anytime: \`pnpm ai:review\`. Exit code is 0 only on PASS.`,
      ``,
    ].join("\n")
  );
  console.log(`\n✓ wrote ${path.join(OUT_DIR, "REVIEW.md")} + review-attestation.json`);

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
