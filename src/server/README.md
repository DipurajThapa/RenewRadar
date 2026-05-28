# `src/server/`

All server-only code. Imported by `src/app/**/page.tsx` (RSC), `src/app/**/actions.ts` (server actions), and `src/app/api/**/route.ts` (route handlers). **Never** imported by anything under `src/ui/`.

| Subfolder | What it owns |
|---|---|
| `domain/` | Pure business types + invariants. No I/O. No framework. |
| `application/` | Use cases — orchestrate domain + infrastructure into business operations. |
| `infrastructure/` | Adapters to the outside world — Postgres, Stripe, Resend, R2 (future), Inngest, crypto, CSV, PDF. |
| `middleware/` | Cross-cutting action-call concerns — auth resolver, RBAC, demo-mode flag. |
| `jobs/` | Inngest functions (background work). |

Imports flow inward. See [docs/architecture/layers.md](../../docs/architecture/layers.md) for the full matrix.
