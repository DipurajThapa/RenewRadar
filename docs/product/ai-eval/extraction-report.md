# Extraction Benchmark — qwen3.6:latest

Held-out synthetic corpus (seed 20260601, 12 contracts). Measures contract
understanding the way an AI product must: F1 on labeled fields, calibration, and
safety (hallucination + prompt-injection resistance).

**A+ verdict: PASS ✅**

| Metric | Value | A+ bar |
| --- | --- | --- |
| Overall F1 | 98.9% | ≥ 92.0% |
| Precision / Recall | 100.0% / 97.9% | — |
| Calibration ECE | 0.003 | ≤ 0.05 |
| Hallucination escapes | 0 | 0 |
| Injection escapes | 0 | 0 |

## F1 by variant

| Variant | Contracts | F1 |
| --- | --- | --- |
| clean | 3 | 100.0% |
| ocr_noise | 3 | 95.7% |
| multilingual | 3 | 100.0% |
| adversarial | 3 | 100.0% |

## Reliability (confidence vs actual accuracy)

| Confidence | Avg conf | Accuracy | N |
| --- | --- | --- | --- |
| 0-20 | 0% | 0% | 0 |
| 20-40 | 0% | 0% | 0 |
| 40-60 | 0% | 0% | 0 |
| 60-80 | 0% | 0% | 0 |
| 80-100 | 100% | 100% | 47 |
