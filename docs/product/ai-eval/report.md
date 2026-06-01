# AI Reasoning Eval — qwen3.6:latest

Local-LLM reasoning measured against the deterministic baseline on the golden set.
This is the Gate-3 measurement: it proves the model is good enough to default-on,
and that the no-hallucination validator actually holds.

## Summary

| Metric | Value |
| --- | --- |
| model | qwen3.6:latest |
| briefs | 6 |
| llmFiredRate | 100% |
| recommendationAcceptableRate | 100% |
| agreementWithDeterministic | 50% |
| hallucinatedQuoteEscapes | 0 |
| avgLatencyMs | 13559 |
| confidenceWhenCorrect | 93 |
| confidenceWhenIncorrect | 0 |
| askGroundedEvidenceOk | true |
| askHonestNoDataOk | true |

**Gate-3 verdict: PASS ✅**

## Briefs

| Scenario | LLM fired | Action | Acceptable | Agrees w/ det | Claims | Quote escapes | Conf | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| imminent-deadline-low-value | Y | renewed_with_adjustments | ✅ | Y | 3 | 0 | 90% | 12663ms |
| missed-deadline | Y | deferred | ✅ | Y | 2 | 0 | 100% | 7628ms |
| rising-above-benchmark-with-clause | Y | renewed_with_adjustments | ✅ | Y | 4 | 0 | 90% | 15280ms |
| flat-below-benchmark-low-urgency | Y | renewed_with_adjustments | ✅ | n | 4 | 0 | 95% | 16262ms |
| no-clause-hallucination-trap | Y | renewed | ✅ | n | 3 | 0 | 95% | 15496ms |
| credible-walkaway | Y | renewed_with_adjustments | ✅ | n | 3 | 0 | 85% | 14027ms |

## Ask

| Scenario | Expect grounded | LLM fired | Answers | Grounded evidence | Honest no-data | Latency |
| --- | --- | --- | --- | --- | --- | --- |
| biggest-risk | Y | Y | 1 | 100% | — | 5418ms |
| vendor-spend | Y | Y | 1 | 100% | — | 4977ms |
| unanswerable-empty-facts | n | n | 0 | 100% | ✅ | 0ms |
