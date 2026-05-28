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
| **ui** | — | — | — | — | — | — | — | — | ✅ | ✅ |
| **shared** | — | — | — | — | — | — | — | — | — | ✅ |

Read as: a file in the row's layer **may import from** the columns marked ✅. Anything blank is forbidden.

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
