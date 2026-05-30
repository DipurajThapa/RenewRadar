# AI-First Redesign Blueprint

> Status: **architect review — approved direction pending**. This is a reuse-first enhancement plan for the **existing** Renewal Radar, grounded in a file-level audit. It introduces **no new product, no parallel system, and no duplicate dashboards/tables/services**. The goal: turn the current SaaS-renewal tracker into an **AI-native renewal & expiration operating assistant** that prepares everything for human approval.

## Verdict (honest)

Renewal Radar is **~70–75% of the way to AI-first — but only for one obligation type (SaaS subscriptions), and the AI is fragmented rather than unified.**

**Already real and reusable (~70%):** the deadline engine (`renewal_event` + notice-deadline math), a genuine 6-pass `DeterministicReasoningProvider` behind a key-gated `getReasoningProvider` factory, the human-gated `applyExtractedField` write path (the *only* AI→source-of-truth path), the autonomous Renewal Agent (already built, SYSTEM-prepped), per-claim evidence + confidence + `validateBrief` verbatim binding, the review queue + evidence UI, the internal-notice draft, the ICS feed, every SQL read repo a Q&A layer needs, and 10 pattern-compliant provider seams.

**Missing or fragmented (~30%):**
1. The data model is **hard-keyed to SaaS** — no `category`, `vendorId` NOT NULL, `billingCycle` NOT NULL with no one-time value, a closed 6-value extraction enum. Non-SaaS obligations can't be represented without fake data.
2. The AI **reasons three times per item with divergent outputs** — the genuine deterministic reasoner, plus two heuristic recommenders (decide-now, prep-pack) that can disagree. Heuristic theater.
3. **Compliance/insurance expiries are silently un-alerted** — `compliance_artifact.expires_at` is indexed but no cron reads it.
4. **No grounded assistant / ask-anything** surface exists.
5. Email is the **one seam that breaks the adapter pattern** (bare Resend singleton).
6. Field coverage is **~35%** (6 of ~17 fields); **no vision/OCR**, **no inbound email**.

**Net:** the engine generalizes by **adding columns to one table**; ~85% of the AI-first behavior rides existing machinery the moment `subscription` becomes a polymorphic *renewal item*. The genuinely-new 15% is the grounded assistant module (already on the product backlog) and 3–4 new adapter seams — all forced to reuse the existing `extract → review → apply → brief` pipeline and the provider-seam template.

## The data-model decision: generalize, never fork

**Broaden the existing `subscriptionsTable` into the universal "renewal item." Zero new tables, zero new engines, zero new screens** — because `renewal_event`, `renewal_brief`, `renewal_notice_draft`, the agent, the alert crons, savings, vendor events, audit, and the KPIs **all key on `subscriptionId`**, so every obligation type rides the same machinery the instant it's a row here.

Minimal, non-breaking migration (6 steps):
- **M1** — add `category` enum (default `saas_subscription`): `software_license, contract, vendor_agreement, insurance_policy, compliance_cert, government_notice, domain_dns, warranty_amc, professional_membership, personal_item, other`. Every existing `status='active'` query keeps working.
- **M2** — add `attributesJson jsonb default '{}'` for the type-specific long tail (policy number, jurisdiction, certifying body, license seat-pool) — mirrors the existing `briefJson`/`metadataJson` pattern; avoids a column per type.
- **M3** — relax two SaaS-locked NOT NULLs: `vendorId` nullable (a government notice/passport has no vendor) and `billingCycle` gains `one_time`/`none` (a cert just expires).
- **M4** — extend `aiFieldKeyEnum` + `documentKindEnum` + the `applyExtractedField` switch with obligation-generic keys (`expiry_date` → `termEndDate`, `issuer`, `reference_number`, + the missing brief fields) through the **same** `ai_extracted_field → review → applyExtractedField` path. Document kinds gain `license, certificate, policy, notice, statement`.
- **M5** — make compliance/insurance expiries **emit a `renewal_event`** off their expiry date via the existing `createSubscriptionWithRenewalEvent` path, so they flow into alerts, digests, the agent, and KPIs. `compliance_artifact` stays the record-keeping ledger it already is.
- **M6** — generalize the savings/decision vocabulary as needed (the `savings_kind` enum already has `renegotiated`/`avoided_increase`).

## What I will NOT build (the non-negotiable, enforced)

- ✗ A new renewal-item / license / contract / insurance / notice **table** — broaden `subscriptions`.
- ✗ A second expiry **scanner** over `compliance_artifact` — emit a `renewal_event`, reuse the one engine.
- ✗ A parallel AI **extraction module** per document type — extend the enum + the `apply-field` switch.
- ✗ A second **recommendation engine** — delete the two heuristic recommenders; consume the brief's `recommendedAction` everywhere.
- ✗ An `action_package` **table** or new package type — assemble a **read-time view-model** over the existing brief + notice draft.
- ✗ A new evidence/confidence/**facts store** — `ai_extracted_field` + `BriefClaim.evidence` *are* the fact store; derive the VERIFIED/INFERRED/UNCERTAIN label.
- ✗ A **new dashboard**, a duplicate ranked queue, or a 4th calendar — enhance `/dashboard`, converge onto `/action-queue`, keep the 3 intentional calendar surfaces.
- ✗ A new `/assistant` full-page route or parallel AI client — host the grounded assistant **inline** (TopNav), route through `getReasoningProvider`, deep-link to existing screens.
- ✗ A second AI factory / email helper / channel fan-out / uploader / parser / vendor normalizer — refactor in place, keep public signatures.
- ✗ An **auto-send / auto-confirm / confidence-gated auto-apply** shortcut — the autonomy boundary is fixed (prepare/draft/recommend only).
- ✗ A re-derivation of the autonomous agent — already built; only surface its SYSTEM-prepped output and extend it to prep the unified package.

## Autonomy boundary (fixed)

The assistant **prepares, organizes, drafts, recommends, prioritizes, and keeps everything ready**. It must **never** independently send email, pay, renew, cancel, sign, approve, or modify external systems. Every external/irreversible action requires human approval. (Already enforced: the agent preps internally; drafts never send.)

## Phased rollout (reuse-first; offline-now before needs-key)

**Phase 1 — Generalize the spine (offline, foundational, zero keys).** The 6-step migration; extend extraction keys + document kinds + the apply-field switch; make compliance/insurance expiries emit renewal events (they finally alert); **kill the heuristic theater** (route prep-pack + decide-now onto the brief's `recommendedAction`, delete the two duplicate recommenders). Outcome: every obligation type is representable and rides the existing engine; one source of truth per item. No new screens, no keys.

**Phase 2 — Unify the AI operating layer in place (offline, the command-center beats).** Assemble the read-time **per-item action package** on `/subscriptions/[id]` (vendor questions, missing-info, per-item `.ics`, reminder line — all derived brief fields). Surface the agent's SYSTEM-prepped work as a **"Prepared for you"** rollup on the dashboard. Converge the 4 workflow pages (review-queue / approvals / requests / spend) into the unified **"Needs you" queue** on `/action-queue`. Add the account-risk `AIInsightCard` (replacing the dead "coming soon" placeholder), the derived **VERIFIED/INFERRED/UNCERTAIN** label + a **missing-information** section on the review queue. Fix the email seam (→ `EmailProvider`, keep `sendEmail()` signature) and the Slack fan-out. All reuses existing components/repos.

**Phase 3 — Grounded assistant on the deterministic path (offline, the one sanctioned-new capability).** A read-only `application/assistant/` router/composer; extend `ReasoningProvider` with `answerQuestion` (deterministic default composes from retrieved rows) + `validateAnswer`; add a retrieval seam (deterministic SQL-dispatch default + dormant vector scaffold). Host an **"Ask"** panel inline in TopNav rendering reused `ClaimRow` evidence + deep-links. Answers carry source + confidence + explicit/inferred/uncertain + missing-info. Ships fully working with **no API key**.

**Phase 4 — Flip the keys + external adapters (needs-key, additive, no caller changes).** `AI_REASONING_PROVIDER`/`AI_EXTRACTION_PROVIDER=anthropic` lights up genuine reasoning, full-field extraction, and grounded answers through the already-wired dormant adapters; implement real **vision-OCR** behind the existing `OcrProvider` contract; add **inbound-email ingestion** feeding the existing pipeline. Optional: vector retrieval, calendar two-way push, vendor enrichment, external task sync — each a new seam following the canonical template, each strictly advisory/internal, none crossing the autonomy boundary.

## Integration-adapter readiness

| Seam | Status |
|---|---|
| AI reasoning (`getReasoningProvider`) | exists — deterministic default, Anthropic dormant-but-wired, evidence-validated |
| AI extraction / insights | exists — heuristic default, Anthropic key-gated |
| Storage, spend, CRM, analytics, DNS, rate-limit | exists — pattern-compliant factories |
| OCR text | partial — text-only default; vision needs a key-gated provider behind the same contract |
| Email outbound | partial — refactor the bare Resend singleton into `EmailProvider` (keep `sendEmail()`) |
| Notification fan-out | partial — converge Slack onto `dispatchNotification` via `NotificationChannelProvider` |
| Calendar | partial — read-only ICS; optional write/push provider later |
| Grounded retrieval + answer | new — `Retriever` (deterministic SQL default + vector scaffold) + `answerQuestion` on the existing reasoner |
| Inbound email, vision-OCR, vector store, task sync, vendor enrichment | new — typed interface + offline mock now; keys plug in later |

Every new seam copies the canonical template: `interface (types.ts) + working-offline default + key-gated *-not-configured adapter + env-switch factory + _setForTests`.
