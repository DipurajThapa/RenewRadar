# Model-Tier Leaderboard (extraction) — accuracy × latency × cost

Held-out corpus (seed 20260601, 2 contracts). Pick the strongest model
for the brief; the cheapest model clearing F1≥0.9 with 0 escapes for the
latency-sensitive Ask panel. Cost prices each model's measured token usage at
$0.00015/1k input + $0.00020/1k output
(hosted-equivalent — local inference is free; override via COST_*_PER_1K).

| Model | F1 | ECE | Halluc. esc | Inj. esc | Latency/doc | Tokens/doc | $/1k docs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3.6:latest | 100.0% | 0 | 0 | 0 | 12908ms | 1296 | $0.22 |
| llama3.1-storm:8b | 71.4% | 0.167 | 0 | 0 | 10668ms | 1104 | $0.18 |

**Recommendation:** brief → `qwen3.6:latest` (accuracy-first); Ask → `qwen3.6:latest` (latency-first); best value → `qwen3.6:latest` (cost-first).
