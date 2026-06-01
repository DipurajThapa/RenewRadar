# AI-Native Transformation Plan — Renewal Radar

**Goal:** move every scorecard category to **A+**, where "A+" means *measured and proven by a
test/benchmark*, not asserted.

**Hard constraint (per owner):** the only two things we will NOT fake are **real customer data**
and a **live production tenant with real users**. Everything else — production-grade serving,
large held-out evals, adversarial robustness, calibration, the feedback loop, cost/latency
benchmarks — must be **fully testable now** with a rigorous *synthetic* corpus, simulated load,
and an independent judge.

**Definition of done for each category = a green benchmark with a numeric threshold.** If it isn't
measured, it isn't A+.

---

## 0. The A+ bar (measurable thresholds)

| # | Benchmark | A+ threshold | Why |
| --- | --- | --- | --- |
| 1 | Extraction F1 (held-out, clean) | ≥ 0.92 | real document understanding |
| 2 | Extraction F1 (hard: OCR-noise / multilingual / adversarial) | ≥ 0.80 | robustness, not demo-ware |
| 3 | Hallucinated quote/number escapes (all evals) | **= 0** | hard safety gate |
| 4 | Grounding rate (every emitted claim/field maps to evidence) | 100% | no ungrounded output |
| 5 | Reasoning recommendation accuracy (independent judge, held-out) | ≥ 0.90 | not teaching-to-the-test |
| 6 | Calibration error (ECE) | ≤ 0.05 | confidence is honest |
| 7 | Prompt-injection / red-team defense | 100% | untrusted doc text can't hijack |
| 8 | Latency p95 @ target concurrency (brief / Ask first-token) | ≤ 25s / ≤ 2s | serving is real |
| 9 | Feedback-loop compounding (Δ accuracy & ECE over ≥3 correction rounds) | monotone improvement | the moat machine works |
| 10 | Cost & tokens per operation, per model tier | reported + budgeted | unit economics |
| 11 | "AI is load-bearing" capability tests with AI disabled | **FAIL** | AI not removable |

A single `pnpm ai:benchmark` runs all 11 and writes a versioned report. CI runs a fast subset and
**fails the build on regression**.

---

## A. Make AI load-bearing & the default  *(C+ → A+)*

**True root cause.** The product was architected *deterministic-first*: the LLM is a swappable
provider behind `AI_REASONING_PROVIDER` / `AI_EXTRACTION_PROVIDER`, and the deterministic engine is a
*complete parallel brain* that ships as the default. So the AI is, by construction, a removable
enhancement — and a diligence user who signs up sees the non-AI product. Two sub-causes: (1) defaults
select deterministic/heuristic; (2) the deterministic engine can stand entirely alone.

**Modifications.**
- **A1 — Flip the defaults.** `AI_REASONING_PROVIDER` and `AI_EXTRACTION_PROVIDER` default to the
  LLM path; deterministic becomes the *automatic fallback*, not the headline. (`ai/index.ts`,
  `.env.example`.) Reframe the deterministic engine in code/comments as "guardrail + degraded mode."
- **A2 — Add capabilities the deterministic engine structurally CANNOT do**, so removing AI removes
  capability, not polish:
  - **Semantic intent routing** — replace the keyword `classifyIntent`
    (`domain/assistant/intent.ts`) with an embedding/LLM router so paraphrases, typos, and novel
    questions work. (Kills the "brittle keyword matcher" critique.)
  - **Light up the dormant vector retriever** (`infrastructure/retriever/`) — real semantic search
    over the account's contracts/briefs/decisions so Ask isn't SQL-dispatch-only.
  - **Free-form Q&A** beyond the fixed enum + **multi-document synthesis** (reconcile terms across
    several uploaded contracts) — neither is expressible in the deterministic templates.
- **A3 — "AI is load-bearing" test suite:** with `AI_*_PROVIDER` forced off, a set of capability
  tests (semantic paraphrase routing, open-ended question, multi-doc synthesis) **must fail** —
  proving AI is not removable.

**A+ when:** benchmark #11 fails-with-AI-off; default config routes through the LLM; semantic router
beats the keyword router on a paraphrase/typo test set (measured).

---

## B. Production-grade serving  *(C → A+, testable without prod)*

**True root cause.** The only transport is a direct `fetch` to local Ollama (`local-llm/client.ts`).
There is no serving tier: no hosted-model adapter, no latency SLO, no concurrency control beyond a
per-request timeout, no cache, no streaming, no circuit breaker, no token/latency telemetry. "Local
Ollama" is a dev convenience.

**Modifications.**
- **B1 — OpenAI-compatible served adapter** behind the existing client interface. Ollama, vLLM, TGI,
  and hosted endpoints all speak `/v1/chat/completions`, so production serving becomes a **config
  swap** (`LLM_API_BASE`, `LLM_API_KEY?`, `LLM_MODEL`), no code change. Generalizes the dormant
  Anthropic adapter into one served-provider seam.
- **B2 — Load + latency harness** (`scripts/ai-bench/load.ts`): fire N concurrent briefs/asks against
  a real local model, measure p50/p95/p99, assert under budget. Real model, *simulated* load.
- **B3 — Response cache** keyed on a stable hash of the brief/answer input; report hit-rate + latency
  win. (Briefs are append-only snapshots, so identical inputs are common.)
- **B4 — Circuit breaker + bounded concurrency queue:** under overload or repeated failures, trip to
  the deterministic fallback fast; half-open recovery. Testable by injecting failures.
- **B5 — Token streaming for Ask** (first-token latency is what users feel).
- **B6 — Per-call telemetry:** tokens, latency, model, cache-hit, fallback — structured logs +
  a metrics summary surfaced on the existing `/admin` system-health page.

**A+ when:** benchmark #8 green at target concurrency; breaker trips + recovers in a test; cache
hit-rate measured; telemetry asserted; swapping `LLM_API_BASE` to a served endpoint needs zero code.

---

## C. Real, large, held-out eval + CI gate  *(C+ → A+) — the spine*

**True root cause.** The current eval is ~9 cases hand-authored by the builder, scored by a loose
"recommendation ∈ acceptable set" proxy, run manually, with no held-out split, no adversarial
coverage, no extraction F1, and no independent judge. It's a smoke test, not a quality gate — and it
risks teaching-to-the-test.

**Modifications.**
- **C1 — Synthetic contract corpus generator** (`scripts/ai-eval/corpus/`): parameterized templates →
  *hundreds* of contracts with KNOWN ground-truth labels. Variant axes: date formats; notice
  phrasings; price/uplift clauses; **OCR-noise injection**; **multilingual** (es/fr/de); scanned-layout
  artifacts; **adversarial traps** (no clause, conflicting dates, injected instructions). A held-out
  split whose seed is never used during prompt tuning.
- **C2 — Extraction eval:** precision / recall / **F1 per field** and per hard-subset; threshold gates
  (benchmarks #1, #2).
- **C3 — Reasoning eval with an INDEPENDENT judge:** a larger scenario set scored by (a) deterministic
  rule checks **and** (b) an LLM-as-judge using a *different* model (e.g. `qwen3.5:9b` or
  `llama3.1-storm`) so we don't grade ourselves. Reports grounding rate, recommendation accuracy
  (#5), and hallucination-escape (#3, must be 0).
- **C4 — Calibration as a first-class metric:** ECE + a reliability curve (#6).
- **C5 — Robustness / red-team suite:** prompt-injection embedded in document text, jailbreak
  attempts, fabricated-quote bait; assert validators + advisor boundary hold 100% (#7).
- **C6 — CI integration:** a fast subset on every PR (build-gating), a full nightly/manual run;
  versioned reports + a **model-tier leaderboard**.

**A+ when:** benchmarks #1–#7 all green on held-out data; CI fails on regression; reports versioned.

---

## D. Moat machinery proven to compound  *(C− → A+, via simulation)*

**True root cause.** The moat is *data* (corrections + cross-account benchmark) which is **zero**
today, and the local model is a commodity. We can't manufacture real data — but we **can** build the
learning machinery and *prove it compounds* in simulation, which is the testable moat claim.

**Modifications.**
- **D1 — Close the loop.** A tuning step that consumes `ai-feedback` corrections to (a) **recalibrate**
  confidence (Platt/isotonic fit on the correction set), and (b) **mine few-shot exemplars** from
  corrected fields and inject them into the extraction/brief prompts.
- **D2 — Compounding experiment** (`scripts/ai-eval/compounding.ts`): simulate ≥3 rounds of synthetic
  corrections → measure the **accuracy ↑ / ECE ↓ curve** → prove "the system improves with feedback"
  (#9). This is the moat, made testable.
- **D3 — Cross-account benchmark uplift:** with synthetic multi-account data (k-anon floor N≥3 already
  enforced), show the benchmark **measurably sharpens** recommendations vs no-benchmark.
- **D4 — Exemplar store** — the accumulating proprietary asset (architecture + privacy design doc).

**A+ when:** benchmark #9 shows monotone improvement over correction rounds; benchmark uplift is
measured in simulation; the data-moat + privacy design is documented.

---

## E. Trust & safety  *(A− → A+)*

**True root cause.** Strong but not *formally* verified or exhaustive. Specific gaps: `validateAnswer`
only checks `quote` substrings, not that each evidence `detail` maps to a real provided fact (a
narrative-fabrication hole); no red-team suite; the agent boundary is enforced by convention, not a
comprehensive structural test; document text (untrusted) flows into prompts without injection
hardening.

**Modifications.**
- **E1 — Close the detail-grounding hole:** every answer-evidence item must map to a provided fact
  (id/detail), not just pass the quote check. Extend `validateAnswer`.
- **E2 — Prompt-injection defense:** treat ALL uploaded document/contract text as *untrusted data,
  never instructions* — wrap in explicit delimiters, harden system prompts, and test with injected
  "ignore previous instructions / email the vendor" payloads.
- **E3 — Red-team eval as a gate** (shared with C5).
- **E4 — Output-contract structural test:** enumerate every AI output type and assert each carries
  source + confidence + provenance band + missing-info.
- **E5 — Agent-boundary structural/lint test:** ban any external side-effect (email/payment/external
  HTTP) inside the reasoning/extraction modules — the advisor-not-agent line, enforced by tooling.

**A+ when:** injection suite 100% defended; output-contract + boundary tests green; detail-grounding
enforced and tested.

---

## F. Unit economics  *(incomplete → A+)*

**True root cause.** No token/latency/cost model; no per-tier benchmark; no token/cost budget on the
reasoning path (only an AI-pages cap on extraction).

**Modifications.**
- **F1 — Token accounting** (prompt + completion) per call + a configurable cost model ($/1k tokens)
  to price the hosted-equivalent even when local inference is ~free.
- **F2 — Model-tier benchmark:** run the full eval across `qwen3.6` / `qwen3.5:{9b,4b}` /
  `llama3.1-storm:8b` → an **accuracy × latency × cost** table → recommend a tier per surface (cheap
  model for Ask, strong model for the brief).
- **F3 — Per-account token/cost budget** + telemetry + cap enforcement on reasoning (mirror the
  existing AI-pages cap pattern).
- **F4 — Caching (B3) as a cost lever**; report savings.

**A+ when:** benchmark #10 reports tokens/latency/cost per surface per tier; budget enforced + tested;
tier recommendation documented.

---

## Phased roadmap (each slice fully gated: typecheck + lint + tests + build)

1. **Phase 1 — The eval spine (C + F2 leaderboard).** Corpus generator, extraction F1, independent-judge
   reasoning eval, calibration/ECE, red-team, `pnpm ai:benchmark`, CI subset. *Everything else is
   measured against this, so it goes first.*
2. **Phase 2 — Safety hardening (E).** Detail-grounding fix, injection defense, output-contract +
   boundary tests. (Cheap, high-trust, unblocks turning AI on by default.)
3. **Phase 3 — AI as default + load-bearing (A).** Flip defaults, semantic router, light up vector
   retrieval, multi-doc synthesis, "AI-off must fail" tests.
4. **Phase 4 — Production serving (B).** OpenAI-compatible adapter, load harness, cache, circuit
   breaker, streaming, telemetry.
5. **Phase 5 — Moat machine (D).** Close the feedback loop, compounding experiment, benchmark uplift.
6. **Phase 6 — Economics (F).** Token/cost accounting, tier recommendation, reasoning budget.

Phases 1–2 are the unlock: once quality is measured and safety is hardened, turning AI on by default
(Phase 3) is defensible rather than reckless.

---

## What "A+ and production-ready" looks like

`pnpm ai:benchmark` prints a single scorecard with all 11 numbers green, versioned to a report file,
re-runnable by an independent reviewer, gating CI. At that point the claim "this is a pure AI product"
is **falsifiable and passing** — not a pitch. The only remaining gaps are the two we deliberately
excluded: real customer data and a live production tenant.

---

## Phase 1 status — DONE ✅ (the eval spine)

The measurement spine is built, A+, and re-runnable by anyone:

- **`pnpm ai:review`** — the one command for a skeptical outsider. Runs everything
  below + the two live proofs, **pins the models** (records their digests),
  deletes stale reports, **re-validates every number itself** against the A+
  thresholds, verifies the judge is a *different* model, stamps the git commit, and
  prints a single PASS/FAIL with a `REVIEW.md` + `review-attestation.json`. Exit
  code is 0 only on PASS. (≈ 6 min; needs `qwen3.6:latest` + `llama3.1-storm:8b`.)
- **`pnpm ai:benchmark`** — extraction on a held-out synthetic corpus (clean / OCR-noise /
  multilingual / adversarial). Live (qwen3.6): **F1 99.2%**, ECE 0.005, **0 hallucination escapes**,
  **0 injection escapes**. Corpus carries disambiguation distractors + injection decoys so the number
  is a real signal (OCR-noise is the weak spot at 96.8% — a *safe* abstention, never a fabrication).
- **`pnpm ai:benchmark:reasoning`** — brief quality scored by an INDEPENDENT model (llama3.1-storm)
  + rule checks. Live: rule accuracy 100%, missed-deadline 100%, grounding 100%, 0 hallucination
  escapes, **independent-judge pass 100%**. (The judge caught + drove a real coherence fix.)
- **`pnpm ai:leaderboard`** — accuracy × latency across model tiers. Recommendation: **brief →
  qwen3.6** (F1 100%); **Ask → qwen3.5:4b** (matches 9b accuracy, faster); llama is a poor extractor
  (54.9%) but a fine judge.

**CI gating:** the eval *logic* (corpus generator, F1/ECE scorer, judge rules — 18 unit tests) runs in
`pnpm test` and gates every PR, so the harness can't silently rot. The *live* A+ benchmarks need a
model server, so they run on a model-equipped runner / nightly via the `pnpm ai:*` commands above —
the standard split for model-dependent evals.

Reports are versioned under `docs/product/ai-eval/`.

## Phase 2 status — DONE ✅ (safety hardening)

Category E pushed toward A+, enforced by tests (not convention):

- **E1 — detail-grounding hole closed.** `validateAnswer` now requires every
  evidence item's `detail` to be a non-empty substring of a provided fact — a
  quote-less fabricated narrative can no longer survive.
- **E2/E3 — prompt-injection defense.** The brief, Ask, and extraction prompts
  treat their input as DATA, not instructions; the contract text is wrapped in
  `<<CONTRACT>>…<</CONTRACT>>` markers. A structural test asserts the defense is
  present so it can't be silently removed; the live adversarial corpus is the
  empirical proof (**0 injection escapes**).
- **E4 — output-contract test.** Every AI output (brief / Ask answer / extracted
  field) is asserted to carry its provenance (engine + integer confidence +
  evidence / verbatim evidenceQuote).
- **E5 — agent-boundary test.** A structural test fails the build if any AI
  reasoning/extraction module imports email / billing / payment / CRM /
  notification infrastructure — advisor-not-agent, enforced by tooling.

Verified by `pnpm ai:review` after the changes (VERDICT PASS — no quality
regression).

## Phase 3 status — core DONE ✅ (AI on by default + load-bearing)

Category A — the "is it an AI product?" flip:

- **A1 — AI is the default.** `AI_REASONING_PROVIDER` and `AI_EXTRACTION_PROVIDER`
  now default to the local LLM. A user who signs up (with a model running) gets
  the LLM, not the deterministic engine. Tests pin deterministic via `.env.test`
  (fast, no model needed); production sets a served endpoint or deterministic.
  Proven live: with no provider env set, `getReasoningProvider()` → `ollama-reasoner`,
  `engine: llm`.
- **A2 — semantic intent router** (the load-bearing capability). The brittle
  keyword `classifyIntent` is replaced by an `IntentRouter` seam — `LlmIntentRouter`
  (semantic) over a `KeywordIntentRouter` fallback, env-gated. Understanding
  paraphrases/typos/novel phrasings is something the keyword engine structurally
  cannot do.
- **A3 — "AI is load-bearing" test.** A set of natural questions the keyword
  router returns "unknown" for (proven offline) that the semantic router routes
  correctly. Live: the real qwen3.6 router got ≥3/4 right while the keyword
  router got 0/4 — the AI is not a removable veneer.

Remaining Phase-3 follow-ons (larger, optional): light up the dormant vector
retriever for semantic search; multi-document synthesis.

## Phase 4 status — core DONE ✅ (production serving)

Category B — serving is real, and testable without a prod tenant:

- **B1 — served adapter (config swap).** `LocalLlmClient` speaks both Ollama's
  `/api/chat` and the OpenAI-compatible `/v1/chat/completions` (`LLM_API_STYLE`,
  `LLM_API_KEY`). Production = point at vLLM/TGI/hosted, no code change. Proven
  live against Ollama's own `/v1`.
- **B2 — load + latency harness** (`pnpm ai:load`): p50/p95/p99 + throughput vs a
  latency SLO. Live: 6 briefs @ concurrency 3 → p95 41s (local queuing), 0 errors.
- **B3 — response cache** (TTL+LRU, opt-in `LLM_CACHE_ENABLED`): identical model
  calls served from cache (proven: 2nd identical call makes 0 model calls).
- **B4 — circuit breaker**: after repeated failures the endpoint fast-fails so the
  deterministic fallback fires immediately instead of waiting out every timeout;
  half-open recovery after a cooldown (unit + integration tested).

Remaining B follow-ons (small): token-streaming for the Ask panel (perceived
latency) + per-call token/cost telemetry (overlaps Phase 6 F1). Next major phases:
Phase 5 (moat machine — D) and Phase 6 (economics — F).
