# `scripts/`

Operational and development scripts. Run from the project root.

| Subfolder | Purpose |
|---|---|
| `db/` | Database operations — seed, founding-customer migration |
| `dev/` | Developer-only scripts — shadcn setup, import-path rewrite |

## What lives here vs. `package.json` scripts

Anything under `scripts/` is a real `.ts` or `.sh` file. The `package.json` scripts are thin wrappers (`pnpm db:seed → dotenv -e .env.local -- tsx scripts/db/seed.ts`). New scripts land here; the wrapper lands in `package.json` if it's a frequent operation.

## What does NOT live here

- One-off SQL fixes (use a Drizzle migration instead)
- Anything that mutates production data without a dry-run flag
