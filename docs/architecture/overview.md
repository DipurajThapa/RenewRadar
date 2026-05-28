# Architecture overview

Renewal Radar is a **Next.js 14 App Router monolith** deployed to Vercel. There is one application, one database, one deployment artifact. All client and server code lives in the same TypeScript project. We do **not** split into separate frontend / backend apps because Next.js's value (RSC, server actions, file-based routing) depends on them being co-located.

To still get the SDLC benefits of clean layering (testable domain logic, swappable infrastructure, no UI code reaching into the database), the **inside of `src/`** is layered. Imports across layers are constrained — both by convention and (where we have ESLint configured) by lint rule.

## Top-level shape

```
renewal-radar/
├── src/
│   ├── app/         Next.js routes — pages, route groups, route handlers, server actions
│   ├── server/      All server-only code, layered (domain / application / infrastructure / middleware / jobs)
│   ├── ui/          All React UI — primitives, layout, features, hooks, design tokens
│   ├── shared/      Code that is genuinely safe in both client and server bundles
│   ├── instrumentation.ts   Next.js 14 boot hook (dispatches to Sentry)
│   └── middleware.ts        Next.js edge middleware
├── scripts/         Operational scripts (db seed, migrations, dev setup)
├── drizzle/         Drizzle-managed SQL migrations
├── docs/            This documentation
├── public/          Static assets served by Next.js
└── (config at root) tsconfig, next.config, tailwind, vitest, sentry.*, drizzle.config
```

## Layers inside `src/server/`

| Layer | Path | What it owns | What it depends on |
|---|---|---|---|
| **Domain** | `server/domain/` | Pure business types + invariants. No I/O, no framework. | itself |
| **Application** | `server/application/` | Use cases that orchestrate domain + infrastructure. Each public function is a single business operation (`createSubscriptionWithRenewalEvent`, `upsertSavingsRecordFromDecision`, …). | domain, infrastructure, shared |
| **Infrastructure** | `server/infrastructure/` | Adapters to the outside world: Postgres (Drizzle), Stripe, Resend, R2 (future), Inngest, crypto, PDF, CSV. | domain, shared |
| **Middleware** | `server/middleware/` | Cross-cutting action-call concerns: auth resolver, RBAC, demo-mode. | domain, application, infrastructure, shared |
| **Jobs** | `server/jobs/` | Inngest functions (background work). | application, infrastructure, domain, shared |

## Layers inside `src/ui/`

| Path | What it owns |
|---|---|
| `ui/components/primitives/` | Atomic UI components (shadcn-style: button, input, dialog, …). No business meaning. |
| `ui/components/layout/` | App shell — nav, sidebar, top bar, demo banner. |
| `ui/components/shared/` | Generic UI patterns used by many features (empty-state, urgency pill, FAQ item). |
| `ui/features/<feature>/` | Feature-scoped UI: components for `subscriptions`, `action-queue`, `settings`, `dashboard`, etc. |
| `ui/hooks/` | Browser-only React hooks (currently just `use-toast`). |
| `ui/design-system/` | Tokens, themes, future motion/typography primitives. |

## Where server actions live

Server actions are co-located with their route in `src/app/(group)/<route>/actions.ts`. **This is a Next.js requirement, not a style choice** — the framework registers server actions via filesystem proximity to the route they support. Each `actions.ts` is allowed to import from `@server/*` and `@shared/*` but must never import from `@ui/*` (that's browser-only).

## Where route handlers live

`src/app/api/**/route.ts`. Transport-layer only: parse request → call the relevant `@server/application/*` use case → format response. No business logic in the handler itself.

## Shared layer

`src/shared/` is the only code path that is bundle-safe for both browser and server. It must not import from `@server/*` or `@ui/*`. Today it holds:

- `shared/validation/` — Zod schemas used by both server actions (validate the form) and client forms (display field errors).
- `shared/utils/` — `cn()`, `formatCurrency`, `formatDate`, `daysUntil`, the `groupByMonth` helper. Pure functions, RSC-safe.
- `shared/types/` — Shared types (empty today; reserved for OpenAPI-derived types if we publish a public API).

## Tenant isolation invariant

Every table that holds customer data has an `account_id` column. Every query filters on it. Every mutation re-validates `before.accountId === current.accountId` (defense-in-depth check). A dedicated Vitest suite (`server/infrastructure/db/repositories/__tests__/tenant-isolation.test.ts`) seeds two accounts and asserts no query returns the other account's rows. A coverage guard fails the test run if a new query module is added without a matching `describe()` block in the suite.

See [adr/0002-tenant-isolation.md](adr/0002-tenant-isolation.md).

## Audit-log invariant

Every mutation that changes a business-critical row writes an audit log entry **in the same transaction**, through the single helper at `server/infrastructure/audit-log/writer.ts`. A coverage guard in `server/infrastructure/audit-log/__tests__/coverage.test.ts` fails the build if a new `actions.ts` is added without going through the helper.

See [adr/0003-audit-log-helper.md](adr/0003-audit-log-helper.md).

## Demo mode

Local and staging review can run without Clerk + Stripe + Resend credentials. When `DEMO_MODE=true` AND `NODE_ENV !== "production"`, the auth resolver returns the seeded demo account/user directly; the middleware short-circuits. The double-guard is intentional: it can never be on accidentally in production.

See [adr/0004-demo-mode.md](adr/0004-demo-mode.md).

## What we deliberately do NOT have

- Separate `apps/frontend/` + `apps/backend/` — would break Next.js routing, server actions, and the RSC model. See [adr/0001-nextjs-monolith.md](adr/0001-nextjs-monolith.md).
- DDD bounded contexts as separate packages — premature at this scale; layering inside `src/server/` is enough.
- A REST API for clients — the React app talks to the server through RSC + server actions. A public API is on the roadmap but not a current concern.
- A separate ORM repository pattern — Drizzle's query builder _is_ the repository pattern; we don't wrap it in a second abstraction.
