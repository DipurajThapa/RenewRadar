# Getting started

Local dev runs on a single machine: Node 20+, pnpm 9+, and a local Postgres. No other external services are required thanks to demo mode — see [adr/0004-demo-mode.md](../architecture/adr/0004-demo-mode.md).

## 1. Prerequisites

```bash
node --version    # >= 20
pnpm --version    # >= 9
psql --version    # PostgreSQL client (server can be brew, Docker, or remote)
```

## 2. Install dependencies

```bash
pnpm install
```

## 3. Configure environment

```bash
cp .env.example .env.local
```

For local dev you only need:
- `DATABASE_URL=postgresql://<you>@localhost:5432/renewal_radar`
- `DEMO_MODE=true`
- A placeholder `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (any value that parses; demo mode bypasses Clerk)

Everything else can be left blank for the demo flow.

## 4. Create + seed the database

```bash
createdb renewal_radar
pnpm db:migrate
pnpm db:seed
```

The seed creates one demo account (`Acme Demo Corp`), one user (`Demo User`), and six staggered subscriptions so the dashboards have real-looking content.

## 5. Run the dev server

```bash
pnpm dev
```

Open <http://localhost:3000>. You'll see the marketing site; the demo banner at the top indicates demo mode is active. Click "Open dashboard" to enter the app as the seeded demo user.

## 6. Run the tests

```bash
createdb renewal_radar_test       # one-time
pnpm db:test:migrate              # one-time
pnpm test:run                     # 91/91 should pass
```

The test runner uses a separate `_test` database and refuses to run against anything else (safety guard in `vitest.setup.ts`).

## Common commands

| What | How |
|---|---|
| Run dev server | `pnpm dev` |
| Production build | `pnpm build` |
| Typecheck only | `pnpm typecheck` |
| Watch tests | `pnpm test` |
| Run tests once | `pnpm test:run` |
| Generate new migration | `pnpm db:generate` (after editing schema) |
| Apply migrations | `pnpm db:migrate` |
| Open Drizzle Studio | `pnpm db:studio` |
| Re-seed demo data | `pnpm db:seed` |
| Preview emails | `pnpm email:dev` |

## Where to look next

- [architecture/overview.md](../architecture/overview.md) for the codebase layering
- [runbook.md](runbook.md) for "I broke something locally — how do I fix it" recipes
- [../runbooks/](../runbooks/) for production-side procedures
