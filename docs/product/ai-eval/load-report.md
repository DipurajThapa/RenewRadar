# Load + Latency — qwen3.6:latest

4 briefs @ concurrency 3 against the live model.
(A single local Ollama serializes work, so the tail reflects queuing — the
same harness validates a real multi-replica served deployment.)

| Metric | Value |
| --- | --- |
| Latency p50 / p95 / p99 | 24390 / 45577 / 45577 ms |
| Mean | 29370 ms |
| Throughput | 0.074 req/s |
| LLM fired / errors | 4 / 0 |
| SLO (p95 ≤ 90000ms) | PASS ✅ |
