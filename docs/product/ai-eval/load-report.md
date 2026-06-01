# Load + Latency — qwen3.6:latest

6 briefs @ concurrency 3 against the live model.
(A single local Ollama serializes work, so the tail reflects queuing — the
same harness validates a real multi-replica served deployment.)

| Metric | Value |
| --- | --- |
| Latency p50 / p95 / p99 | 37161 / 41088 / 41088 ms |
| Mean | 34283 ms |
| Throughput | 0.074 req/s |
| LLM fired / errors | 6 / 0 |
| SLO (p95 ≤ 90000ms) | PASS ✅ |
