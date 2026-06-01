# Compounding Experiment — does the feedback loop work?

Simulation (real customer data excluded by design): an overconfident source,
calibrated from accumulating synthetic corrections. The same machinery runs on
real review decisions once usage accumulates.

**Moat verdict: PASS ✅** — baseline ECE 0.204 → final ECE 0.012
(94% better) over 1200 corrections.

| Round | Corrections | Validation ECE |
| --- | --- | --- |
| 0 | 0 | 0.204 |
| 1 | 200 | 0.041 |
| 2 | 400 | 0.049 |
| 3 | 600 | 0.04 |
| 4 | 800 | 0.019 |
| 5 | 1000 | 0.012 |
| 6 | 1200 | 0.012 |
