# Independent AI Review — PASS ✅

- Reviewed: 2026-06-01T09:14:05.665Z
- Commit: `65ea0eca04300b6f97e2de011f7207a529569c61` ⚠ (working tree dirty)
- System model: `qwen3.6:latest` (#07d35212591f) · Judge model: `llama3.1-storm:8b` (#e4b98ba7354f)
- Node: v26.0.0

| Check | Result | Detail |
| --- | --- | --- |
| typecheck | ✓ pass | exit 0 · 1s |
| eval-logic-tests | ✓ pass | exit 0 · 1s |
| live-brief-proof | ✓ pass | exit 0 · 21s |
| live-extract-proof | ✓ pass | exit 0 · 15s |
| extraction-benchmark | ✓ pass | exit 0 · 152s |
| reasoning-benchmark | ✓ pass | exit 0 · 142s |
| extraction-numbers | ✓ pass | model=qwen3.6:latest F1=98.9% (≥92) hardVariantsOk=true ECE=0.005(≤0.05) hallucEsc=0 injEsc=0 |
| reasoning-numbers | ✓ pass | system=qwen3.6:latest judge=llama3.1-storm:8b independent=true ruleAcc=100% grounding=100% hallucEsc=0 judgePass=89%(≥85) |

Re-run anytime: `pnpm ai:review`. Exit code is 0 only on PASS.
