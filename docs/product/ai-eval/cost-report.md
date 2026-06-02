# Unit Economics — qwen3.6:latest

Real reasoning ops metered, priced at $0.00015/1k input +
$0.00020/1k output (hosted-equivalent; local inference is free).

| Metric | Value |
| --- | --- |
| Tokens / op | 1242 |
| Cost / op (hosted-eq) | $0.000210 |
| Cost / 1k ops | $0.21 |
| Cache hit-rate (warm pass) | 50% |
| Cache savings (this run) | $0.000630 |
| Monthly @ 10000 ops — local | $0.00 |
| Monthly @ 10000 ops — hosted | $2.10 |
| Monthly @ 10000 ops — hosted + cache | $1.05 |
| Cache working | ✅ |
| Economics | PASS ✅ |

**Read:** caching turns identical re-asks (e.g. regenerating an unchanged
brief) into $0 — the warm pass fired 0 new model calls. A
per-account budget cap (`checkBudget`) bounds worst-case spend; over budget,
the deterministic engine serves for free.
