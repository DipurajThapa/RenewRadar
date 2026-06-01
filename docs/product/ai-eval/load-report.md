# Load + Latency — qwen3.6:latest

5 briefs @ concurrency 1 against the live model.
(A single local Ollama serializes work, so the tail reflects queuing — the
same harness validates a real multi-replica served deployment.)

| Metric | Value |
| --- | --- |
| Latency p50 / p95 / p99 | 15459 / 18753 / 18753 ms |
| Mean | 14155 ms |
| Throughput | 0.071 req/s |
| LLM fired / errors | 5 / 0 |
| SLO (p95 ≤ 25000ms) | PASS ✅ |
