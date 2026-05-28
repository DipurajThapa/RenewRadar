# Layer import rules

The codebase is layered. Imports flow inward (toward domain), never outward.

## Allowed-import matrix

|     | domain | application | infrastructure | middleware | jobs | app routes | app actions | api routes | ui | shared |
|-----|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **domain** | ✅ | — | — | — | — | — | — | — | — | ✅ |
| **application** | ✅ | ✅ | ✅ | — | — | — | — | — | — | ✅ |
| **infrastructure** | ✅ | — | ✅ | — | — | — | — | — | — | ✅ |
| **middleware** | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ |
| **jobs** | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — | ✅ |
| **app routes (pages)** | ✅ | ✅ | ✅ | ✅ | — | — | — | — | ✅ | ✅ |
| **app actions** | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ |
| **api routes** | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ |
| **ui** | ✅* | ✅** | ✅†‡ | — | — | — | — | — | ✅ | ✅ |
| **shared** | — | — | — | — | — | — | — | — | — | ✅ |

Read as: a file in the row's layer **may import from** the columns marked ✅. Anything blank is forbidden.

The UI row has three pragmatic exceptions (marked with footnote symbols):

- **\* `ui → @server/domain/*`** — Domain modules are pure: types, constants, and
  side-effect-free helpers (`scoreRisk`, `calculateNoticeDeadline`, `annualizeCents`,
  `TIER_DEFINITIONS`, etc.). They have no Node-only dependencies, so they're
  bundle-safe in the browser. Importing them from UI is intentional.
- **\*\* `ui → @server/application/*`** — only via `"use server"`-marked modules
  (server actions). Next.js handles these as RPC: the client component invokes
  them; the actual code runs server-side. The import does not pull server code
  into the client bundle. Server actions co-located with their route in
  `src/app/**/actions.ts` are the more common pattern; the modules under
  `@server/infrastructure/billing/{checkout,portal}.ts` are also server actions
  by virtue of their `"use server"` directive.
- **† `ui → @server/infrastructure/db/{schema,repositories}`** — only as
  `import type { ... }`. TypeScript erases type-only imports at build time,
  so the row types from Drizzle don't reach the browser bundle. Runtime
  imports from these modules are forbidden.
- **‡ `ui → @server/middleware/demo-mode`** — the `isDemoMode` constant is
  computed from `process.env`. In a server-component context (where `top-nav.tsx`
  imports it) it evaluates correctly; in a client bundle `process.env.DEMO_MODE`
  is undefined and the constant is `false`. The import is safe in either case.

All other paths into `@server/*` from UI are forbidden because they would drag
`postgres`, `node:crypto`, `resend`, or the Stripe SDK into the browser bundle.
The bundler will error before it ships; the rule documents the intent.

## Why each rule

- **`ui/` cannot import `@server/*`.** Server code uses `node:crypto`, `postgres`, `drizzle-orm`, `resend`, Stripe SDKs — none of these are browser-safe. The boundary is enforced by what the Next.js bundler will tolerate; violating it causes a build error.
- **`shared/` cannot import anything except itself.** It's the one bundle-safe layer, used by both client and server. If `shared/` imported from `server/`, every page that touched a shared util would drag the database client into the browser bundle.
- **`domain/` cannot import infrastructure or middleware.** Domain is pure. Risk score doesn't need a database. The notice-deadline calculator works without Stripe. Keeping the dependency arrow one-way makes domain trivially unit-testable and prevents the "business rule that secretly queries the database" anti-pattern.
- **`application/` may import `infrastructure/` but not vice versa.** Use cases compose infrastructure adapters (insert a row, send an email). Infrastructure adapters don't know what use case is calling them.
- **`infrastructure/` may import `infrastructure/`.** Adapters legitimately compose: the savings application module wraps `db.transaction` + `writeAuditLog`.
- **`app/` can reach all server layers.** Pages, server actions, and API routes are the entry points; they call into the layer that fits the job.

## Where server actions sit in this matrix

Server actions (`src/app/**/actions.ts`) follow the **app actions** row. They are Next.js's required location for the `"use server"` boundary, but conceptually they're thin wrappers around `application/` use cases. The audit-log coverage guard enforces that every actions file either imports `writeAuditLog` directly or delegates to an application module (which calls it internally).

## When you need shared code

Pick the most restrictive layer that works. In order of preference:

1. **`shared/utils/`** if it's a pure function with no I/O and both client and server need it.
2. **`server/domain/`** if it's a pure function or constant that only the server needs.
3. **`server/infrastructure/`** if it has side effects (DB, network, filesystem, time, randomness).
4. **`server/application/`** if it composes infrastructure into a business operation.

If you find yourself wanting `ui/` code from `server/`, you almost certainly have the abstraction wrong. The opposite — `ui/` importing `shared/` — is fine and common.
