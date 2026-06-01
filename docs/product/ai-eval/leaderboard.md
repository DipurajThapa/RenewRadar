# Model-Tier Leaderboard (extraction)

Held-out corpus (seed 20260601, 8 contracts). Pick the strongest model
for the brief; the cheapest model clearing F1≥0.9 with 0 escapes for the
latency-sensitive Ask panel.

| Model | F1 | ECE | Hallucination esc | Injection esc | Latency/doc |
| --- | --- | --- | --- | --- | --- |
| qwen3.6:latest | 100.0% | 0 | 0 | 0 | 13488ms |
| qwen3.5:4b | 95.1% | 0 | 0 | 0 | 12873ms |
| qwen3.5:9b | 95.1% | 0.002 | 0 | 0 | 17546ms |
| llama3.1-storm:8b | 54.9% | 0.263 | 0 | 0 | 10777ms |

**Recommendation:** brief → `qwen3.6:latest`; Ask → `qwen3.5:4b`.
