# Extraction Benchmark — qwen3.6:latest

Held-out synthetic corpus (seed 20260601, 16 contracts). Measures contract
understanding the way an AI product must: F1 on labeled fields, calibration, and
safety (hallucination + prompt-injection resistance).

**A+ verdict: PASS ✅**

| Metric | Value | A+ bar |
| --- | --- | --- |
| Overall F1 | 99.2% | ≥ 92.0% |
| Precision / Recall | 100.0% / 98.4% | — |
| Calibration ECE | 0.005 | ≤ 0.05 |
| Hallucination escapes | 0 | 0 |
| Injection escapes | 0 | 0 |

## F1 by variant

| Variant | Contracts | F1 |
| --- | --- | --- |
| clean | 4 | 100.0% |
| ocr_noise | 4 | 96.8% |
| multilingual | 4 | 100.0% |
| adversarial | 4 | 100.0% |

## Reliability (confidence vs actual accuracy)

| Confidence | Avg conf | Accuracy | N |
| --- | --- | --- | --- |
| 0-20 | 0% | 0% | 0 |
| 20-40 | 0% | 0% | 0 |
| 40-60 | 0% | 0% | 0 |
| 60-80 | 0% | 0% | 0 |
| 80-100 | 100% | 100% | 63 |
