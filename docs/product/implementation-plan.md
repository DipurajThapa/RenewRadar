# Renewal Radar — Final Features & Implementation Plan

> **Status:** Approved architect-level synthesis. This document supersedes earlier internal specs where they conflict.
> **Last reconciled:** 2026-05-28
> **Inputs:** `Renewal_Radar_Market_Ready_Claude_Code_Execution_Plan.md` (strategic plan) + live audit of `renewal-radar/` codebase as of today.
> **Author role:** Full-stack developer + system architect (single source of opinion).

---

## 0. The decision in one paragraph

The current V1 MVP is **not throw-away** — schema, multi-tenancy, notice-deadline math, decision workflow, billing, audit-log table, and cancellation letter are all real and working. But it stops at "prettier tracker," which the strategic plan correctly identifies as the existential risk. The next 90 days must convert it into a **renewal command center**: contract-in → extracted-fields with evidence → human review → owner assigned → notice-deadline alert → action → outcome + savings logged. Everything else (CSV import, multi-user, SSO, integrations) is sequenced behind that wedge because nothing else justifies the price points already shipped on `/pricing`.

The product positioning lands at: **Extract. Prove. Alert. Act. Save.**

---

## 1. What we keep (do not touch)

These survive the upgrade verbatim. Any refactor that breaks them is rejected.

| Asset | Why it stays |
|---|---|
| `account / user / vendor / subscription / renewal_event / notification / audit_log` core schema | Clean, indexed, FK-correct, tenant-scoped. Foundation for everything below. |
| `accountId`-on-every-row + `getCurrentAccountAndUser()` resolver | Multi-tenant isolation is sound. Do not introduce a second tenancy pattern. |
| Notice-deadline calculation (`src/lib/notice-deadline/calculate.ts`) + 30/14/7/3/1-day thresholds | This is the wedge. The math is right and the thresholds match the strategic plan. |
| Inngest crons: `renewal-event-state` (07:00 UTC) + `notice-deadline-alerts` (08:00 UTC) | Correct ordering, correct retries=3, correct dedup via unique constraint on notification. |
| `notification` table with `(userId, trigger, entityType, entityId)` unique constraint | The right way to prevent duplicate alerts. Do not switch to a custom de-dup map. |
| Cancellation letter generator (`decide-now/cancellation-letter-draft.tsx`) — never sends on user's behalf | Honors the binding principle. Keep client-side rendering + mailto + copy. |
| Stripe billing + `tier-definitions.ts` as the canonical pricing source | Architectural decision is correct. Pricing *values* will change (see §6); the structure does not. |
| Demo mode (`isDemoMode`, `DEMO_ACCOUNT_ID`) + double env-guard | Required for sales demos and local review. Keep verbatim. |
| Marketing site sections + public `/pricing` + `/privacy` + `/terms` | Ship-quality. Edits live; rewrites do not. |
| Clerk auth + webhook-based account provisioning | Works. Replace only if/when we add SAML SSO (Pro+, not before V2). |

**Binding principles** (these constrain every decision below; do not relax):

1. **Advisor, never agent.** We recommend; the human acts.
2. **No money movement.** No virtual cards. No payments to vendors. No portal scraping for cancellations.
3. **<30-min onboarding** for a buyer to first value.
4. **Manual-first, AI-assisted.** AI never silently mutates a business-critical date. Human review is mandatory before extracted fields become production data.
5. **Privacy by default.** No outbound vendor scraping. No data sold. Document storage is tenant-scoped and encrypted at rest.

---

## 2. What is missing — measured against the wedge

The audit found that the codebase implements roughly **Phase 1** of the strategic plan (Stabilize) and most of **Phase 1.5** (alerts). What is *not* implemented and is required for paid market readiness:

| Gap | Current state | Severity |
|---|---|---|
| Owner assignment surfaced in UI | `subscription.ownerUserId` column exists but no form field, no filter, no display | 🔴 P0 — schema-ready, just wire it up |
| Action queue ("what to do this week") | None. We have a notice-deadline page, but no consolidated cross-subscription queue with risk-ranking | 🔴 P0 |
| CSV import | None. Manual entry only. Plan says this is the fastest onboarding lever | 🔴 P0 |
| Contract / document upload | None | 🟠 P1 — gates everything AI |
| AI extraction (notice period, renewal date, auto-renew, price, cancellation method) | None | 🟠 P1 |
| Evidence snippets (page number, source quote) | None | 🟠 P1 |
| AI review queue (accept / edit / reject) | None | 🟠 P1 |
| Renewal Prep Pack (export bundle of dates, clauses, owners, action) | None | 🟠 P1 |
| Savings tracker (logged when user records a decision) | `renewal_event.decision` enum exists; no savings calc, no aggregate view | 🟠 P1 |
| Risk score (composite of value + days-to-deadline + auto-renew + price-increase) | None | 🟠 P1 |
| Audit log query/viewer UI | Table + writes exist; no read surface | 🟡 P2 |
| Multi-user / invites | Schema supports it (`role` column on user); no invite flow, no membership concept | 🟡 P2 |
| RBAC (Admin / Manager / Reviewer / Approver / Viewer) | Single role field; no permission matrix | 🟡 P2 |
| Slack / Teams alerts | None | 🟡 P2 |
| Calendar sync (ICS export) | None | 🟡 P2 |
| Weekly digest / monthly summary emails | Notification triggers exist as enum values; no Inngest job | 🟡 P2 |
| SAML SSO | None | 🟢 P3 (Pro/Enterprise) |
| Tests (any) | Zero `.test.ts` files | 🟠 P1 — write as you build the above, not as a separate sprint |

**Deferred backlog — not in V2; reconsider after paid launch.** These remain on the parking lot, not rejected. Each carries a precondition that must be true before we revisit it.

| Backlog item | Precondition to revisit | Open tension to resolve first |
|---|---|---|
| Full CLM authoring (drafting + redlining contracts in-product) | ≥10 paying Pro/Enterprise customers asking for it AND a dedicated contracts-PM hire | Wrong battlefield today — Ironclad/Linksquares own it. Revisit only if customers stop renewing because we lack it. |
| Virtual cards / payment rails | A path that does not violate binding principle 2 (no money movement on the customer's behalf) — e.g., read-only card-issuance via Ramp/Brex partnership where *they* hold the rails | Conflicts with principle 2 as stated. Either the principle relaxes (explicit founder decision, documented) or we partner rather than build. |
| Deep SaaS usage telemetry / browser-extension license tracking | A clear answer to "what does our extension see and where does it send the data" that survives a SOC 2 review | Privacy posture today says we don't watch users. An extension changes that contract — needs a fresh privacy-page rewrite + customer comms. |
| Pricing benchmark marketplace | Anonymized contract corpus from ≥100 paying accounts AND legal sign-off that aggregated price disclosure is contractually permitted | We have no corpus. Cannot bootstrap without seeding from another source (acquisition or partnership). |
| Generic AI chatbot ("ask anything about your contracts") | Evidence-backed Q&A (every answer cites the document + page) AND a hard rule that it cannot mutate data | Plain chat without evidence is what we said we wouldn't be. A grounded Q&A surface over the existing `ai_extracted_field` corpus is a different — and more interesting — feature, and may end up shipping under a different name. |
| Procurement workflows beyond approvals-lite (multi-step routing, budget gates, vendor scoring) | ≥3 customers actively using approvals-lite AND asking for the next step | Premature today. Approvals-lite in Phase E will tell us whether anyone uses it before we extend it. |

---

## 3. Final feature set (the V2 paid-market product)

Below is the canonical feature list. Each item is tagged with **MVP-now** (currently in `main`), **Ship-in-90d** (the upgrade), or **Defer** (post-paid-launch).

### 3.1 Core renewal tracking

| Feature | State | Notes |
|---|---|---|
| Subscription CRUD | MVP-now | Keep. Form modal + full-page coexist. |
| Vendor registry per account | MVP-now | Keep. |
| Renewal event state machine (`upcoming → notice_window → action_needed → missed/processed`) | MVP-now | Keep. |
| Subscription status (`draft / active / paused / pending_cancellation / cancelled / expired`) | MVP-now | Keep. |
| **Owner assignment** | Ship-in-90d | Schema ready (`ownerUserId`). Add field to form + filter to list + display chip on detail and queue. |
| **Action queue** | Ship-in-90d | New `/action-queue` route. Ranks renewals across all subscriptions by composite risk (see §3.4). |
| **CSV import** (manual upload + column mapping) | Ship-in-90d | `papaparse` server-side. Stream rows; validate per Zod; insert in a transaction; report errors per-row. |
| **CSV export** (full data + reports) | Ship-in-90d | Same pipeline in reverse. |

### 3.2 Notice-deadline intelligence (the wedge)

| Feature | State | Notes |
|---|---|---|
| Notice deadline calculation | MVP-now | Keep. |
| 30/14/7/3/1-day email alerts | MVP-now | Keep. |
| In-app notification feed | Ship-in-90d | Schema already supports `channel = "in_app"`. Wire up a bell-icon UI + mark-read action. |
| Missed-notice escalation (already done as state transition) | MVP-now | Add a daily summary email when missed-state lands. |
| **Configurable per-user alert windows** (which thresholds + which channels) | Ship-in-90d | Extend `user.notificationPrefs` jsonb. |
| **Weekly digest** + **monthly summary** | Ship-in-90d | Two new Inngest crons. Reuse existing notification trigger enums. |

### 3.3 Document + AI extraction (the moat)

| Feature | State | Notes |
|---|---|---|
| **Document upload** (PDF + DOCX, tenant-scoped storage) | Ship-in-90d | See §4 (Storage). |
| **Text extraction / OCR** | Ship-in-90d | PDF text first (most contracts are searchable); OCR fallback (Mistral OCR or AWS Textract) only for image-based PDFs. |
| **AI metadata extraction** (renewal date, notice period, auto-renew, contract value, price-increase clause, cancellation method) | Ship-in-90d | Claude Sonnet 4.6 (claude-sonnet-4-6). Structured JSON per `aiExtractionSchema`. |
| **Evidence snippets** (page number + verbatim quote per field) | Ship-in-90d | Required by binding principle 4. No field without evidence. |
| **AI review queue** (accept / edit / reject per field) | Ship-in-90d | New `/review-queue` route. Approval mutates `subscription` / `renewal_event` + writes audit log. |
| **AI confidence + model version stored** | Ship-in-90d | Per-field, per-run. Surface to user. |
| **Approved field application is the only write path** from AI to production data | Ship-in-90d | Enforce in code: extraction writes to `ai_extracted_field` only; never directly to `subscription`. |

### 3.4 Risk + value visibility

| Feature | State | Notes |
|---|---|---|
| **Risk score (per renewal)** | Ship-in-90d | Composite 0–100: `urgency(days_to_notice_deadline) × value(annualUsd) × clause_pressure(auto_renew + price_increase)`. Pure function; recomputed on demand. |
| **Value-at-risk dashboard widget** (sum of annualized value across subscriptions in `action_needed`) | Ship-in-90d | Reuse existing dashboard surface. |
| **Savings tracker** | Ship-in-90d | New `savings_record` table — see §4.2. Auto-created when a decision is `cancelled` or `renewed_with_adjustments` (downgrade). User can edit the captured amount before commit. |
| **Outcome reports** (renewed / renewed-with-adjustments / downgraded / cancelled / deferred + savings rollup) | Ship-in-90d | `/reports` route. CSV/PDF export. |

### 3.5 Prep & action

| Feature | State | Notes |
|---|---|---|
| Cancellation letter draft | MVP-now | Keep. |
| **Renewal Prep Pack** (PDF bundle per subscription: contract summary + key clauses + extracted fields + owner + risk + recommended action + 30-day timeline) | Ship-in-90d | Generated on-demand. React-PDF or Puppeteer. |
| **Approvals-lite** (a user submits a decision; another user marks "approved") | Ship-in-90d | New `decision_approval` row on `renewal_event`. Optional per-account setting. |

### 3.6 Trust & enterprise basics

| Feature | State | Notes |
|---|---|---|
| Multi-tenant isolation tests | Ship-in-90d | First test suite to write. One Vitest file per query module. |
| **Multi-user accounts + invites** | Ship-in-90d | New `invitation` table. Email invite → Clerk sign-up → user provisioned to inviter's `accountId`. |
| **RBAC** (`owner / admin / member / viewer`) | Ship-in-90d | Start with 4 roles, not 5. `member` can edit; `viewer` cannot. Owner sets roles. |
| Audit log viewer UI | Ship-in-90d | `/settings/audit` (admin+ only). Filter by actor / entity / date. |
| Retention settings (per-account configurable) | Ship-in-90d | Free=30d, Starter=12mo, Growth=24mo, Pro=36mo, Enterprise=7y. Already in `TIER_DEFINITIONS`; enforce in audit-log purge cron. |
| Security & privacy page (subprocessors, encryption, data handling) | Ship-in-90d | Static MDX page. |
| **SAML SSO** | Defer (V2.5) | Clerk supports it; needs Pro/Enterprise plan with them. Wait for first paying enterprise customer. |
| **SCIM** | Defer (V3) | Not before SSO. |

### 3.7 Integrations

| Feature | State | Notes |
|---|---|---|
| **ICS calendar export** (single URL per account) | Ship-in-90d | Easy win. One file. |
| **Slack alerts** (incoming webhook URL per account) | Ship-in-90d | Webhook only. No OAuth app. New `integration` table — single row per account per type. |
| Teams alerts | Defer (after first Slack adopter) | Same webhook pattern. |
| Drive / OneDrive contract import | Defer (V2.5) | Manual upload first. |
| Vendor APIs (Stripe Billing, Atlassian, etc.) for auto-discovery | Defer (V3) | Bigger battlefield. Not the wedge. |

---

## 4. Data model changes

### 4.1 New tables (additive — no destructive migrations on existing tables)

```ts
// src/lib/db/schema.ts — additions

// Document storage
export const documentTable = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionTable.id, { onDelete: "set null" }),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => userTable.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),               // S3/R2 key, tenant-scoped prefix
  checksumSha256: text("checksum_sha256").notNull(),
  pageCount: integer("page_count"),
  textExtractionStatus: documentExtractionStatusEnum("text_extraction_status").notNull().default("pending"),
  textContent: text("text_content"),                       // null until extraction completes
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byAccountIdx: index("document_account_idx").on(t.accountId),
  bySubIdx: index("document_subscription_idx").on(t.subscriptionId),
}));

// Per-run record of an AI extraction (one document can have many runs as we re-extract)
export const aiExtractionRunTable = pgTable("ai_extraction_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documentTable.id, { onDelete: "cascade" }),
  model: text("model").notNull(),                           // "claude-sonnet-4-6"
  promptVersion: text("prompt_version").notNull(),          // "v1.0"
  status: aiExtractionRunStatusEnum("status").notNull().default("queued"),
  errorMessage: text("error_message"),
  costUsdMicros: integer("cost_usd_micros"),                // for usage caps
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  byAccountIdx: index("ai_extraction_run_account_idx").on(t.accountId),
  byDocIdx: index("ai_extraction_run_document_idx").on(t.documentId),
}));

// One row per extracted field per run; the unit of human review.
export const aiExtractedFieldTable = pgTable("ai_extracted_field", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => aiExtractionRunTable.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documentTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptionTable.id, { onDelete: "set null" }),
  fieldKey: aiFieldKeyEnum("field_key").notNull(),          // renewal_date, notice_period_days, auto_renewal, etc.
  rawValue: text("raw_value"),                              // string form, even for numerics
  parsedValueJson: jsonb("parsed_value_json"),              // typed value or null
  confidence: doublePrecision("confidence").notNull(),
  evidenceQuote: text("evidence_quote"),
  evidencePageNumber: integer("evidence_page_number"),
  reviewStatus: aiFieldReviewStatusEnum("review_status").notNull().default("pending"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => userTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewerEditedValueJson: jsonb("reviewer_edited_value_json"), // populated when reviewStatus = "edited"
  appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => ({
  byAccountIdx: index("ai_extracted_field_account_idx").on(t.accountId),
  byRunIdx: index("ai_extracted_field_run_idx").on(t.runId),
  byStatusIdx: index("ai_extracted_field_status_idx").on(t.accountId, t.reviewStatus),
}));

// Savings rollup — auto-created on decision, user-editable until "locked"
export const savingsRecordTable = pgTable("savings_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  renewalEventId: uuid("renewal_event_id").notNull().references(() => renewalEventTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionTable.id, { onDelete: "cascade" }),
  kind: savingsKindEnum("kind").notNull(),                  // cancelled | downgraded | renegotiated | avoided_increase
  baselineAnnualUsdCents: integer("baseline_annual_usd_cents").notNull(),
  newAnnualUsdCents: integer("new_annual_usd_cents").notNull(),
  savedAnnualUsdCents: integer("saved_annual_usd_cents").notNull(),
  note: text("note"),
  lockedAt: timestamp("locked_at", { withTimezone: true }), // null = editable; non-null = immutable
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byAccountIdx: index("savings_record_account_idx").on(t.accountId),
}));

// Account-level integrations (Slack webhook, ICS URL secret, etc.) — single row per (account, kind)
export const integrationTable = pgTable("integration", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  kind: integrationKindEnum("kind").notNull(),              // slack_webhook | ics_export | teams_webhook
  configJson: jsonb("config_json").notNull(),               // encrypted secrets where applicable
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqByAccountKind: uniqueIndex("integration_account_kind_unique").on(t.accountId, t.kind),
}));

// User invitations for multi-user accounts
export const invitationTable = pgTable("invitation", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accountTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
  token: text("token").notNull(),                           // signed JWT or random
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqAccountEmail: uniqueIndex("invitation_account_email_unique").on(t.accountId, t.email),
}));
```

### 4.2 Modifications to existing tables

```ts
// user: tighten the role enum (currently free-form text)
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member", "viewer"]);
// → migration: ALTER COLUMN role TYPE user_role USING role::user_role;

// subscription: link to primary contract document (optional)
//   ALTER TABLE subscription ADD COLUMN primary_document_id uuid REFERENCES document(id) ON DELETE SET NULL;

// renewal_event: explicit approval state for approvals-lite
//   ALTER TABLE renewal_event ADD COLUMN approval_status renewal_approval_status NOT NULL DEFAULT 'not_required';
//   ALTER TABLE renewal_event ADD COLUMN approved_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL;
//   ALTER TABLE renewal_event ADD COLUMN approved_at timestamptz;
```

### 4.3 New enums

```ts
documentExtractionStatusEnum: "pending" | "extracting" | "ready" | "failed"
aiExtractionRunStatusEnum:    "queued" | "running" | "succeeded" | "failed"
aiFieldKeyEnum:               "renewal_date" | "notice_period_days" | "auto_renewal" | "contract_value_cents"
                              | "price_increase_clause" | "cancellation_method"
aiFieldReviewStatusEnum:      "pending" | "accepted" | "edited" | "rejected" | "applied"
savingsKindEnum:              "cancelled" | "downgraded" | "renegotiated" | "avoided_increase"
integrationKindEnum:          "slack_webhook" | "ics_export" | "teams_webhook"
renewalApprovalStatusEnum:    "not_required" | "pending" | "approved" | "rejected"
```

### 4.4 What the strategic plan's "22 entities" map to in our schema

The plan lists 22 conceptual entities. We collapse — we do not need 22 tables. Mapping:

| Plan entity | Our table | Note |
|---|---|---|
| Organization | `account` | Same thing. |
| User | `user` | |
| Role | `user.role` enum + RBAC matrix in code | No separate table needed; flat enum is enough. |
| Renewal | `renewal_event` | |
| Contract | `document` (kind=contract) + `subscription` | Contract terms = `subscription`; the file = `document`. |
| Document | `document` | |
| Vendor | `vendor` | |
| Customer | n/a | We are B2B-only; the buying org IS the account. |
| Subscription | `subscription` | |
| Clause | `ai_extracted_field` (where field_key implies a clause) | No separate clause table. |
| Obligation | `ai_extracted_field` (where field_key = notice_period_days) | Derived. |
| NoticePeriod | `subscription.noticePeriodDays` | Already a column. |
| RenewalEvent | `renewal_event` | |
| RiskScore | derived (pure function, recomputed on read) | No table — recompute on demand to avoid stale data. |
| Recommendation | derived | Same. |
| Task | `renewal_event` + `action_queue` view (no new table; action queue is a query) | Don't over-model "tasks." The action queue is a query over renewal events. |
| Approval | `renewal_event.approval_status` (new column) | No separate table. |
| Notification | `notification` | |
| Integration | `integration` (new) | |
| AuditLog | `audit_log` | |
| AIExtractionRun | `ai_extraction_run` (new) | |
| ExtractedField | `ai_extracted_field` (new) | |
| SavingsRecord | `savings_record` (new) | |

**Result: 6 new tables, 3 existing-table additions, 8 new enums. No table renames. No destructive migrations.**

---

## 5. Storage, AI, and security choices

These are the architect-level technology calls. Lock these in.

| Concern | Decision | Why |
|---|---|---|
| Object storage | **Cloudflare R2** (S3-compatible, no egress fees) | Cheap, simple, regional. Use one bucket; tenant-scoped key prefix `account/{accountId}/document/{documentId}/{filename}`. |
| Storage access | **Server-only signed URLs**, never client-direct PUT | Defends tenant isolation. Server validates accountId before signing. |
| Encryption at rest | **R2 default (AES-256)** | Documented on security page. |
| Encryption in transit | TLS everywhere; no plain-HTTP routes | Standard. |
| Text extraction | **`pdf-parse` (pure-JS)** for searchable PDFs | Free, in-process. Fast. |
| OCR (fallback for image PDFs) | **Mistral OCR API** | Cheaper than Textract; good enough; pay-per-page. Behind a feature flag — only invoke if `pdf-parse` returns <100 chars. |
| AI extraction model | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Best price/perf for structured extraction in 2026-05. Opus is overkill; Haiku misses clause nuance. |
| AI prompt | **Single structured-extraction prompt with JSON schema enforcement.** Prompt version stored on each run. | Prompts are versioned, evaluated, and pinned. Re-extracting an old document requires a new run. |
| AI evidence requirement | **Every numeric/date/clause field must include `evidence_quote` (verbatim ≤500 chars) + `page_number`. No evidence = field rejected at validation time.** | Binding principle 4. |
| AI usage caps | Per-account monthly extraction-page budget per tier (Starter 200, Growth 1,000, Pro 5,000, Enterprise unlimited). Track in `ai_extraction_run.cost_usd_micros` + nightly cron. | Prevents one runaway account from sinking our margin. |
| Background jobs | Keep **Inngest**. Document extraction = new `extract-document` function with `concurrency: { limit: 3, key: accountId }`. | Same infra as alerts. Per-tenant concurrency cap. |
| Auth | Keep **Clerk**. Move to Clerk Organizations for V2 multi-user (their model maps cleanly to our `account`). | Avoid rolling our own. SAML when we get there is a Clerk plan upgrade. |
| Database | Keep **Postgres + Drizzle**. Production: **Neon** with autoscaling. | No change. |
| Secrets | **Vercel encrypted env vars** for V1; **Vercel KMS** / **Doppler** when team grows | Documented in `RUNBOOK.md`. Slack webhooks and ICS export secrets stored in `integration.config_json`, encrypted with `@vercel/blob` envelope or a single account-scoped DEK. |
| Observability | Keep **Sentry**. Add **OpenTelemetry → Axiom** for Inngest job traces + AI extraction latencies. | Required to debug AI extraction failures. |

---

## 6. Pricing recalibration

The current `/pricing` page is well-built but the **values** must change. The strategic plan is right: Starter at $79 cannot stand without AI extraction; Growth at $299 cannot stand with "V2" markers on its features; Pro at $899 cannot stand without SSO.

Two options. Pick one and edit `src/lib/billing/tier-definitions.ts` accordingly.

### Option A — Hold pricing, ship features (preferred)

Keep the price points. Ship the V2 feature set in 90 days. **Remove every "V2" marker from `FEATURE_MATRIX`** before charging — replace with concrete features that are now real (AI extraction, evidence review, prep pack, savings tracker).

| Tier | Price | Anchor feature (post-90d) |
|---|---|---|
| Free Forever | $0 | 5 subscriptions, alerts, cancellation letter |
| Starter | $79/mo | + AI extraction (200 pages/mo), action queue, CSV import |
| Growth | $299/mo | + savings tracker, prep pack, Slack alerts, approvals-lite, 1,000 pages |
| Pro | $899/mo | + audit log export, custom DPA, 5,000 pages, 4hr SLA |
| Enterprise | From $18K/yr | + SAML SSO, custom retention, CSM |

### Option B — Drop prices now, raise on V2 ship

Starter → $49, Growth → $199, Pro → $599 today; raise back to $79/$299/$899 when AI extraction lands. Communicates "early-customer pricing" honestly.

**Architect's call: Option A.** Reasons:
- We are 90 days from feature-complete; do not anchor cheap and then ask for a 60% raise.
- The strategic plan explicitly says: "Do not charge mainly by record count" — but the AI page caps in Option A *do* charge by intelligence consumed, which is the right signal.
- Founding customers (per `FOUNDING_CUSTOMER_MIGRATION.md`) already get a price lock. Discount them; don't reprice the catalog.

**Required edits to ship before Phase B1 below:**

1. In `tier-definitions.ts`, replace every `"(V2)"` feature string with a real feature now or remove it.
2. Add `aiExtractionPagesPerMonth` to the `limits` object per tier.
3. Update the `breakEven.event` lines on Growth and Pro to reference AI-extracted clauses (concrete proof) rather than generic seat reclaim.
4. The marketing-home `PricingTeaser` and `/pricing` page are derived from `tier-definitions.ts`, so they update automatically.

---

## 7. The single sequencing plan (next 90 days)

Today: **2026-05-28**. Phase exit dates are absolute, not relative.

### Phase A — Stabilize what's real (exit by **2026-06-11**, ~2 weeks)

Goal: lock the current MVP behind tests + a clean owner story before adding any new module.

- [ ] **Vitest configured** (`vitest.config.ts`, `npm test` script). Two test files to start:
  - `src/lib/db/queries/__tests__/tenant-isolation.test.ts` — for every query, assert that a second account's data is never returned.
  - `src/lib/notice-deadline/__tests__/calculate.test.ts` — table-driven test of all 5 thresholds + missed + edge cases (notice period 0, multi-year, term-end in past).
- [ ] **Owner assignment UI**. Field on `SubscriptionForm`, chip on subscription detail, filter on subscriptions list, chip on dashboard `NoticeDeadlineSpotlight`.
- [ ] **Audit log writer helper** (`src/lib/audit/write.ts`) — single function `writeAuditLog(tx, {accountId, actorUserId, action, target, before, after})`. Migrate the two existing direct inserts to use it.
- [ ] **Audit log viewer** at `/(app)/settings/audit` (owner/admin only).
- [ ] **In-app notification feed** (bell icon in top nav; reuses `notification` table; mark-read action).
- [ ] **Replace "V2" markers in `FEATURE_MATRIX`** with the feature set that will be real by end of Phase D.

**Exit criteria:** `npm test` green. Owner assignment works end-to-end. Audit log readable. Pricing page no longer references unbuilt features.

### Phase B — Action queue + CSV (exit by **2026-06-25**, ~2 weeks)

Goal: the buyer's first "wow" — paste in their spreadsheet and immediately see ranked actions.

- [ ] **CSV import** at `/(app)/subscriptions/import`. Two-step UX: upload → column mapping preview (with sample rows) → confirm. Server action streams rows, validates per `subscriptionInsertSchema`, inserts in a single transaction, returns per-row results.
- [ ] **CSV export** for subscriptions + renewals.
- [ ] **Risk score** as a pure function in `src/lib/risk/score.ts`. Inputs: subscription, renewal_event. Output: 0–100 + a 3-letter band.
- [ ] **Action queue** at `/(app)/action-queue`. Lists every subscription where `renewal_event.status IN ('notice_window','action_needed','missed')` OR `risk_score >= 60`, sorted by composite urgency. Each row has owner, value-at-risk, days-to-deadline, one-click "View" + "Open prep pack" actions.
- [ ] **Configurable alert windows** in `/(app)/settings/notifications`.

**Exit criteria:** A user can upload 50 rows of CSV in <30 seconds, see them ranked on the action queue, and click into the highest-risk one.

### Phase C — Documents + AI extraction (exit by **2026-07-23**, ~4 weeks — the big one)

Goal: the moat. The thing competitors can't trivially copy.

- [ ] **Document upload** to R2. Server-signed PUT. Validate MIME (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), size ≤20 MB, page count ≤200.
- [ ] **`extract-document` Inngest function**. Steps: download → `pdf-parse` text → if <100 chars then Mistral OCR fallback → write `document.text_content` → set status `ready`.
- [ ] **`run-ai-extraction` Inngest function**. Steps: load document text → call Claude Sonnet 4.6 with structured-extraction prompt → validate JSON schema (zod) → reject any field missing evidence_quote/page_number → write one `ai_extracted_field` row per field with `review_status='pending'`.
- [ ] **Review queue** at `/(app)/review-queue`. Per-field UI: shows extracted value, confidence, evidence quote, page number, current value on the subscription. Buttons: Accept / Edit (inline edit) / Reject. Apply mutates `subscription`/`renewal_event` + writes audit log + sets `review_status='applied'` + `applied_at`.
- [ ] **Document linker** on subscription detail page — "Attach contract" → upload or pick from prior uploads. Triggers extraction run.
- [ ] **Per-tier usage caps** enforced in the queue function. Block with a clear upgrade nudge if account is over.
- [ ] **AI tests**: a fixture-based test in `src/inngest/__tests__/extract.test.ts` that runs the prompt against 5 canned contracts and asserts field-level F1 score ≥0.85. Run in CI but skip in pre-commit.

**Exit criteria:** Upload a real PDF contract → within 60s see 6 fields in the review queue with evidence → accept all → see the subscription's notice-deadline update + audit log entries written.

### Phase D — Savings + prep pack + reports (exit by **2026-08-13**, ~3 weeks)

Goal: prove the ROI. The thing the buyer puts in their renewal QBR.

- [ ] **Savings tracker**. When a user logs a `cancelled` or `renewed_with_adjustments` decision, prompt for the baseline and new annual amounts; auto-compute saved; write a `savings_record`. Editable for 30 days, then locked.
- [ ] **Renewal Prep Pack** PDF generation. React-PDF (`@react-pdf/renderer`). One page per subscription with: vendor + product, contract dates, notice deadline, owner, risk score, extracted clauses with evidence quotes, recommended action, 30-day timeline.
- [ ] **Reports** at `/(app)/reports`: Exposure (sum of annualized value by status), Savings YTD (sum of `savings_record.savedAnnualUsdCents`), Missed-deadline rollup, Upcoming-action calendar. CSV export each.
- [ ] **Weekly digest** + **monthly summary** Inngest crons.
- [ ] **ICS export** (single signed URL per account; respects integration kind `ics_export`).

**Exit criteria:** A user can generate a Prep Pack PDF, download it, and forward to their vendor account exec.

### Phase E — Multi-user + trust (exit by **2026-08-27**, ~2 weeks; ships paid-launch ready)

Goal: pass a 25–500 employee buyer's security checklist.

- [ ] **Invitations** + Clerk Organizations integration. Invite by email; new user is provisioned to the inviter's `accountId`.
- [ ] **RBAC** (owner / admin / member / viewer) enforced server-side via a `requireRole(account, user, "admin")` helper called at the top of every action.
- [ ] **Approvals-lite** — per-account toggle. When on, decisions require a second user with `admin` or `owner` to approve before audit log records "applied."
- [ ] **Slack webhook integration**. UI: paste webhook URL in `/settings/integrations`. Cron posts daily action-queue summary if configured.
- [ ] **Security page** at `/security` (subprocessors, encryption, retention, deletion).
- [ ] **DPA template** at `/legal/dpa` (downloadable; Pro+).
- [ ] **Retention enforcement cron** — daily job that purges audit log entries older than tier's retention window.
- [ ] **Founding-customer migration** complete per `FOUNDING_CUSTOMER_MIGRATION.md`.

**Exit criteria:** Two users from the same account can collaborate; a viewer cannot mutate data; the security page answers every question on a typical SMB vendor-review questionnaire.

### What ships after 90 days (V2.5+, do not build before)

- SAML SSO (Pro/Enterprise)
- Drive / OneDrive contract import
- Teams alerts
- Vendor API integrations (auto-discovery)
- Duplicate-vendor detection
- Forecasting / spend benchmarks
- SCIM
- Public API + webhooks for customers

---

## 8. Engineering invariants — keep these as PR-review gates

Every PR for the next 90 days is reviewed against these. If any are violated, the PR does not land.

1. **Tenant isolation:** every new query filters `accountId`. Every new mutation re-validates `before.accountId === current.accountId` (defense-in-depth check). New tables get `accountId` + an account-scoped index.
2. **AI mutations require human approval.** No code path may write an AI-extracted value directly into `subscription` or `renewal_event`. The only write path is `applyExtractedField()`, which requires `review_status='accepted' OR 'edited'` AND `reviewedByUserId IS NOT NULL`.
3. **Evidence-or-reject.** Any AI-extracted field without `evidence_quote` and `page_number` is rejected at validation time. No exceptions, even for high-confidence scalars.
4. **Audit-log writes are not optional.** Any mutation that changes `subscription`, `renewal_event`, `account`, `user`, `invitation`, or `savings_record` writes an audit log entry in the same transaction. Add a Vitest in `src/lib/audit/__tests__/coverage.test.ts` that fails when an action handler is added without a corresponding audit call.
5. **Single source of truth.** Tier data → `tier-definitions.ts`. Notice-deadline math → `lib/notice-deadline/`. Risk score → `lib/risk/`. Annualization → `lib/billing/annualize.ts`. Tone → `lib/notice-deadline/tone.ts`. **Do not** re-declare any of these in components.
6. **No silent mailto changes.** The cancellation letter component must continue to render via `mailto:` or clipboard. Never wire it to send via Resend on the user's behalf.
7. **No outbound vendor calls** (scraping cancellation portals, calling vendor APIs to cancel) before V3. Binding principle 2.
8. **Demo mode stays double-guarded.** `process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production"`. Never relax to single-guard.
9. **Drizzle migrations are additive.** No table renames, no destructive column drops, no PK changes. Phase A–E land via `db:generate` + `db:migrate`. Rollback path documented per migration.
10. **Tests land with the feature, not after.** Each Phase exit requires green Vitest. AI tests run in CI nightly.

---

## 9. What I am explicitly choosing not to do (and why)

| Tempting move | Why I'm not doing it |
|---|---|
| Add a separate `clause` table and a `task` table per the strategic plan's 22-entity model | Over-modeling. `ai_extracted_field` carries clauses; the action queue is a derived query. Fewer tables → fewer migrations → less drift. |
| Switch to Supabase / Convex / etc. | Postgres + Drizzle + Neon works. No upside justifies the rewrite cost in the 90-day window. |
| Build a vector index for contract Q&A in V2 | Generic AI chatbot is on the "do not build" list. Structured extraction with evidence is the product. |
| Build an admin "agent" that proposes contract redlines | Crosses the advisor-vs-agent line. Out. |
| Build SCIM in Phase E | No customer asking for it. Wait for the second enterprise prospect to demand it. |
| Add Datadog | Sentry + Axiom is enough until we have on-call. |
| Mobile app | Web responsive is enough. No mobile-first user persona. |
| AI-generated cancellation letter via Claude | Boilerplate template is what buyers trust. AI here adds risk without adding clarity. |

---

## 10. Reconciliation table — strategic plan vs. this final plan

| Plan recommendation | This document | Why the divergence (if any) |
|---|---|---|
| Position as "Extract. Prove. Alert. Act. Save." | ✅ Adopted | None. |
| Don't rebuild; upgrade in place | ✅ Adopted | None. |
| 22 entities | 6 new tables + 3 column adds | Conceptual entities mapped to existing or derived. Smaller surface area; same expressiveness. |
| Free Forever 5 records + AI extraction credits in Starter | ✅ Adopted | None. |
| Drop Starter to $49 if no AI | Hold $79, ship AI in 90 days (Option A in §6) | Founders want to charge confidently; raising later signals weakness. |
| Phase 1 → Phase 6 (six phases, ~6 months) | A → E (five phases, 90 days) | Bootstrap timeline. Phase 6 (vendor history, recommendation engine, forecasting) deferred to V2.5+. |
| Approval-lite in Phase 5 | ✅ In Phase E | Aligned. |
| Full RBAC matrix (5 roles) | 4 roles (owner / admin / member / viewer) | Simpler. Add "approver/reviewer" later if a buyer needs separation of duties. |
| Calendar sync, Slack, Drive in Phase 5 | ICS + Slack only in Phase E; Drive deferred | One adopter per integration; cheapest two ship first. |
| Pricing benchmarks (P3) | Defer to V3 | Requires market data we don't have. |
| Full CLM | Backlog (see §2) | Wrong battlefield today; revisitable if paying customers demand it. |
| Virtual cards | Backlog (see §2) | Conflicts with binding principle 2 as-stated; revisit only via partnership or after an explicit principle change. |
| Generic AI chatbot | Backlog (see §2) | Plain chat is the wrong shape; an evidence-grounded Q&A surface over `ai_extracted_field` is the interesting version. |

---

## 11. First five things to do this week (concrete, not strategic)

In order. Do not parallelize until the first three land.

1. **Set up Vitest** in the repo. Add `npm test` and `npm run test:ci`. Write the tenant-isolation test first; it will already pass, but it locks the contract.
2. **Add `owner` field to `SubscriptionForm`** + the corresponding chip on the subscription detail card + the column on the table.
3. **Extract a `writeAuditLog(tx, ...)` helper** in `src/lib/audit/write.ts`; migrate the two existing call sites; add the Vitest in §8.4.
4. **Edit `src/lib/billing/tier-definitions.ts`** — remove every "(V2)" marker, add `aiExtractionPagesPerMonth` to limits, update break-even copy.
5. **Open Phase B** by stubbing `src/app/(app)/action-queue/page.tsx` with the empty-state, even before the query exists. Forces commitment.

---

## 12. Single sentence the buyer sees on the homepage in 90 days

> **Upload your contracts. Renewal Radar finds the real cancellation deadline, shows you where it found it, assigns an owner, alerts them before it's too late, and tracks what you saved.**

That is the product. Build that. Ship the rest only when this sentence is unambiguously true.
