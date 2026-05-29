# Renewal Radar

**SaaS Renewal Intelligence** for IT / Ops / Procurement leads at 25–500-person companies. Renewal Radar builds your subscription inventory *itself*, watches every notice deadline, and turns each renewal into an evidence-backed recommendation — so you stop being the data pipe and stop missing auto-renewals.

> **Advisor, never agent.** Renewal Radar drafts, recommends, and reconciles. It never emails your vendors, never moves money, and never pools or sells your data. A human sends every external communication.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local          # fill in values — comments explain each

# Local Postgres (or Neon). Apply migrations + seed demo data:
pnpm db:migrate
pnpm db:seed

pnpm dev                            # http://localhost:3000
```

**Demo mode** (no Clerk account needed): set `DEMO_MODE=true` in `.env.local`. Auth is bypassed and a seeded demo account loads automatically — ideal for local review. Never use a demo build for real customer data.

New here? Read the **[User Manual](docs/user-manual.md)** for a guided tour of every workflow.

---

## What it does

**Build the inventory (kill the manual-entry tax)**
- Manual add, **CSV import** (diff-preview + undo), **paste-from-spreadsheet (TSV)**, **industry starter templates**, and **bulk multi-file contract upload** with **AI field extraction** (dates, price, notice clause) routed through an evidence **review queue**.
- **Spend feed (auto-discovery):** connect a card/expense feed and recurring charges are **detected automatically** (cadence + price-trajectory + refund-aware), then wait for one-click human confirmation into the inventory. You confirm; Renewal Radar never adds anything silently.

**Never miss a deadline**
- Notice-deadline calculation, an **action queue** ranked by urgency + risk score, escalating email/Slack alerts, a 12-month renewal calendar, and **ICS** calendar export.

**Decide well (the AI that isn't theater)**
- **Renewal Intelligence Brief:** a multi-signal, evidence-backed recommendation reasoning over the subscription's *own* price trajectory (fed by the real spend-feed charge history), the cross-account benchmark, notice-window urgency, negotiation leverage, and your prior decisions. Per-claim provenance is honest (`deterministic` vs `llm`); nothing is asserted without evidence.
- **Decide Now** workflow + **cancellation-letter draft** (you send it).
- **Safe-agent internal notice draft:** Renewal Radar composes an *internal* renewal memo for your procurement owner — editable, copy/download — **never addressed to the vendor**.

**Prove the value (the ROI loop)**
- **Savings tracker** with **projected → realized reconciliation**: a daily job matches what a decision *aimed* to save against your *actual* post-renewal spend and surfaces "proven savings" on Reports.

**The moat & the network**
- **Cross-account vendor benchmark** (anonymized), per-vendor **intelligence timeline**, **reusable playbooks**.
- **Vendor portal** (vendor-side identity, domain verification, price/renewal announcements) + a **customer-side vendor inbox**.
- **Procurement intake** form + **approvals-lite** (separation of duties).

**Plus:** reports & exports, GDPR-style data export, public API + key auth, audit log, tiered billing (Free Forever → Starter → Growth → Pro → Enterprise) via Stripe.

---

## Architecture

Layered clean architecture with ESLint-enforced import boundaries:

```
src/
  app/                      Next.js 14 App Router — routes, pages, server actions, API
  server/
    domain/                 Pure business logic (no I/O): risk, notice-deadline,
                            recurring-charge detection, savings/notice composition, tiers
    application/            Use cases — orchestrate domain + infrastructure in transactions
    infrastructure/         DB (Drizzle/Postgres), AI/OCR/storage/spend/rate-limit
                            providers (pluggable), audit log, crypto, analytics
    middleware/             Auth resolver, RBAC, demo mode
    jobs/                   Inngest cron + event functions
  ui/                       Components, hooks, design tokens
  shared/                   Validation, utils, cross-cutting types
drizzle/                    SQL migrations (drizzle-kit)
docs/                       Architecture, runbooks, product, user manual
```

Each major folder has its own `README.md` describing its responsibility and boundaries.

**Pluggable provider pattern:** storage, AI extraction, AI reasoning, OCR, spend connectors, rate-limiting and DNS each sit behind an interface with a working **offline default** and a **key-gated adapter** that drops in when credentials land — see "External integration posture" below.

Full design + dataflow diagrams: **[docs/architecture/technical-specification.md](docs/architecture/technical-specification.md)**.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server at `localhost:3000` |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm typecheck` | TypeScript (`strict`, `noUncheckedIndexedAccess`) |
| `pnpm lint` | ESLint (incl. layer-boundary rules) |
| `pnpm test` | Vitest (DB-backed) |
| `pnpm db:generate` | Generate a SQL migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations (dev) |
| `pnpm db:test:migrate` | Apply migrations to the test DB |
| `pnpm db:seed` | Seed local demo data |
| `pnpm db:studio` | Drizzle Studio |

---

## External integration posture

The product is built to run **fully offline with genuinely-working defaults** until paid API keys / domains are purchased — so nothing is a stubbed dead-end:

| Seam | Offline default (today) | Key-gated adapter (drops in later) |
|---|---|---|
| AI reasoning (brief) | Deterministic multi-signal engine | Anthropic (`AI_REASONING_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) |
| AI extraction | Heuristic extractor | Anthropic |
| Spend feed | Fixture connector (realistic dataset) | Ramp/Brex (`SPEND_*` keys) |
| Storage / OCR / rate-limit | Local FS / pdf-parse / in-memory | S3 / cloud OCR / Upstash |

Both AI engines are held to the **same evidence-binding validator**, and every claim is labeled with its real engine — a deterministic claim is never dressed up as an LLM one.

---

## Binding principles (baked into code + copy — don't remove)

1. **Advisor, never agent** — drafts/recommendations only; the customer sends every external communication. The spend feed is *read-only ingestion*; reconciliation only *records* what happened.
2. **No money movement** — no bank/card payment rails, no vendor invoice payment.
3. **Never delete users** — soft status flips into an archive, never a hard delete (lint + a structural test ban `db.delete(usersTable)`).
4. **Privacy by default** — cross-account benchmarks are anonymized aggregates; customer data is never pooled, shared, or sold.
5. **Offline-first, integration-ready** — every external dependency sits behind a seam with a working default; no paid keys required to run or demo.

---

## Quality gates

- **Tests:** DB-backed Vitest suite (single-fork, real Postgres) with multi-tenant isolation tests per repository.
- **Structural "fuses":** coverage tests enforce that every account-scoped query is tenant-isolated, every mutation writes an audit-log entry, and every server action checks RBAC — drift fails CI.
- **Typecheck + ESLint + production build** are all green on `main`.

See **[docs/](docs/)** for architecture, runbooks, deployment, and the strategy/wedge memo.
