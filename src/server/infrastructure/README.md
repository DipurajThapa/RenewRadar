# `src/server/infrastructure/`

Adapters between our domain and the outside world. Everything in here has side effects: it queries Postgres, calls Stripe, encrypts bytes, renders a PDF, sends an email.

| Subfolder | Adapter for |
|---|---|
| `db/` | Postgres via Drizzle ORM. `schema.ts` is the source of truth; `repositories/*.ts` are query modules (one per concept). `client.ts` is the singleton DB connection. |
| `audit-log/` | Single canonical writer for the audit log. The ONLY place `tx.insert(auditLogTable)` is allowed. |
| `email/` | Resend client + all React Email templates. |
| `billing/` | Stripe client, checkout, portal, webhook handlers, internal plan-id ↔ tier mapping. |
| `crypto/` | AES-256-GCM envelope encryption for integration secrets. |
| `csv/` | Canonical subscription CSV format + parser; small format helpers for ad-hoc exports. |
| `pdf/` | React-PDF templates (prep-pack today). |

Repositories under `db/repositories/` are functions, not classes. Each repository module owns one entity or concept; cross-entity reads (e.g., action-queue) get their own module.

Repositories must:

- Filter every query on `account_id` (see [tenant isolation ADR](../../../docs/architecture/adr/0002-tenant-isolation.md)).
- Never write the audit log directly — that's the job of `application/` use cases via the canonical writer.
- Surface domain types where possible; raw Drizzle types are fine when the data is internal to the layer.
