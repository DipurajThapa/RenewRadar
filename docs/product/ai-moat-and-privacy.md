# The Data Moat & Privacy Design (Phase 5 / D4)

The local model is a commodity. The moat is **proprietary data that compounds** —
and it must compound **without ever leaking one tenant's data to another**. This
documents the three accumulating assets, the privacy guarantees that bound them,
and the experiments that prove each one works.

## The three compounding assets

| Asset | What accumulates | Where it lives | Effect |
| --- | --- | --- | --- |
| **Confidence calibration** (D1) | Every human accept / edit / reject is a label on the AI's confidence | `ai_extracted_field` (no new table) → `getCalibrationModel` | The AI's confidence becomes honest — overconfident-when-wrong is corrected per account |
| **Few-shot exemplars** (D1) | Reviewer *edits* (AI said X, human fixed to Y, with evidence) | mined by `mineExemplars` from the same rows | The extraction prompt learns this account's domain corrections — it stops making the same mistake |
| **Cross-account benchmark** (D3) | What's *typical* for a vendor across all tenants (notice period, price, auto-renew) | `getVendorBenchmark`, k-anonymized | Recommendations become **relative** ("you're overpaying vs peers"), which single-account data cannot express |

Each is **read from data the product already captures** — no parallel store, no new
collection. They sharpen automatically as the account is used.

## Privacy guarantees (the bounds on the moat)

1. **Calibration + exemplars never leave the owning account.** `getCalibrationModel`,
   `mineExemplars`, and the extraction-prompt injection are all `accountId`-scoped
   (tenant-isolation tests enforce it). One tenant's corrections never train another
   tenant's prompt.
2. **The cross-account benchmark is k-anonymized (N ≥ 3 floor).** A vendor's
   benchmark is only computed when **at least 3** accounts contribute, and it
   exposes only **aggregates** (medians, rates) — never a specific account's value,
   name, or terms. No tenant can reverse a benchmark to another tenant's contract.
3. **No PII in any aggregate.** Benchmarks carry vendor-level statistics, not
   customer identities. Exemplars carry field corrections + the contract's own
   evidence quote, scoped to the account that produced them.
4. **Advisor, never agent.** None of these assets trigger an action — they sharpen
   *advice*. Every downstream AI output still carries source + confidence +
   provenance and passes the no-hallucination validators.

## Proven, not asserted

- **Compounding** (`pnpm ai:compounding`): calibration error falls monotonically as
  corrections accumulate (baseline ECE 0.204 → 0.012, 94% better). The feedback
  loop measurably improves the system. Gated in CI.
- **Benchmark uplift** (`pnpm ai:uplift`): a recommender **with** the peer benchmark
  beats one **without** it — +27 pts of recommendation accuracy (63% → 90%) across
  market segments, because "are you overpaying?" is a relative question. Gated in CI.
- **Few-shot mining** (`mineExemplars` + extraction-prompt injection): unit + DB
  tested — only reviewer *edits* become exemplars, tenant-scoped, and the extraction
  prompt carries them.

The only deliberately-excluded gap is **real customer data**: the experiments run on
seeded synthetic tenants. The exact same machinery runs on real corrections and real
cross-account medians the moment production tenants accumulate them — the code path
is identical; only the data source changes.
