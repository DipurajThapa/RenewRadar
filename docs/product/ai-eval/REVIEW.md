# Independent AI Review — PASS ✅

- Reviewed: 2026-06-01T08:58:57.003Z
- Commit: `795286e246125ecd0554279745932cbc14b301a5` ⚠ (working tree dirty)
- System model: `qwen3.6:latest` (#07d35212591f) · Judge model: `llama3.1-storm:8b` (#e4b98ba7354f)
- Node: v26.0.0

| Check | Result | Detail |
| --- | --- | --- |
| typecheck | ✓ pass | exit 0 · 2s |
| eval-logic-tests | ✓ pass | exit 0 · 1s |
| live-brief-proof | ✓ pass | exit 0 · 20s |
| live-extract-proof | ✓ pass | exit 0 · 15s |
| extraction-benchmark | ✓ pass | exit 0 · 161s |
| reasoning-benchmark | ✓ pass | exit 0 · 138s |
| extraction-numbers | ✓ pass | model=qwen3.6:latest F1=98.9% (≥92) hardVariantsOk=true ECE=0.003(≤0.05) hallucEsc=0 injEsc=0 |
| reasoning-numbers | ✓ pass | system=qwen3.6:latest judge=llama3.1-storm:8b independent=true ruleAcc=100% grounding=100% hallucEsc=0 judgePass=100%(≥85) |

Re-run anytime: `pnpm ai:review`. Exit code is 0 only on PASS.
