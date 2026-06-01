# Independent AI Review — PASS ✅

- Reviewed: 2026-06-01T14:27:38.593Z
- Commit: `e52b3cebedbfc2f246d0acc71d0a17e17674d06b` (clean)
- System model: `qwen3.6:latest` (#07d35212591f) · Judge model: `llama3.1-storm:8b` (#e4b98ba7354f)
- Node: v26.0.0

| Check | Result | Detail |
| --- | --- | --- |
| typecheck | ✓ pass | exit 0 · 2s |
| eval-logic-tests | ✓ pass | exit 0 · 2s |
| live-brief-proof | ✓ pass | exit 0 · 21s |
| live-extract-proof | ✓ pass | exit 0 · 15s |
| extraction-benchmark | ✓ pass | exit 0 · 129s |
| reasoning-benchmark | ✓ pass | exit 0 · 148s |
| load-bearing | ✓ pass | exit 0 · 1s |
| compounding | ✓ pass | exit 0 · 0s |
| load-latency | ✓ pass | exit 0 · 55s |
| cost-economics | ✓ pass | exit 0 · 38s |
| extraction-numbers | ✓ pass | model=qwen3.6:latest F1=98.7% (≥92) hardVariantsOk=true ECE=0.004(≤0.05) hallucEsc=0 injEsc=0 |
| reasoning-numbers | ✓ pass | system=qwen3.6:latest judge=llama3.1-storm:8b independent=true ruleAcc=100% grounding=100% hallucEsc=0 judgePass=89%(≥85) |
| compounding-numbers | ✓ pass | baselineECE=0.204 → finalECE=0.012 (≤0.05) monotone=true |

## A+ benchmark coverage (all 11)

One command, all eleven numbered benchmarks — measured here, not scattered.

| Benchmark | Measured | Proven by |
| --- | --- | --- |
| #1 Extraction F1 (clean) | 98.7% (≥92) | extraction-numbers |
| #2 Extraction F1 (hard subsets) | ≥80% each | extraction-numbers |
| #3 Hallucinated quote/number escapes | 0 (=0) | extraction/reasoning-numbers |
| #4 Grounding rate | 100% (=100) | reasoning-numbers |
| #5 Reasoning accuracy (indep. judge) | judge 89% / rule 100% | reasoning-numbers |
| #6 Calibration error (ECE) | 0.004 (≤0.05) | extraction-numbers |
| #7 Prompt-injection / red-team | 0 escapes (=0) + offline red-team | extraction-numbers + red-team.test |
| #8 Latency p95 @ concurrency | p95 45577ms (SLO gated in Phase B) | load-latency |
| #9 Feedback-loop compounding | ECE 0.204→0.012, monotone=true | compounding-numbers |
| #10 Cost & tokens / op | 1242 tok, 0.000210 $/op | cost-economics |
| #11 AI is load-bearing (AI-off fails) | enforced by router.test (A3) | load-bearing |

**CI note:** `pnpm test:ci` gates every deterministic check on each PR —
the eval-logic math, the behavioral red-team (#7), the output-contract,
the agent boundary, the budget enforcement, and #11 (AI-off fails). The
LIVE-model numbers (#1–6, #8, #10) can't run in a model-less CI; they are
gated here by `pnpm ai:review` pre-release, with this attestation committed.

Re-run anytime: `pnpm ai:review`. Exit code is 0 only on PASS.
