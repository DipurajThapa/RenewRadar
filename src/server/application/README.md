# `src/server/application/`

Use cases — each public function is a single business operation that composes `domain/` rules with `infrastructure/` side effects. Application modules are the only things `src/app/**/actions.ts` should import from (the audit-log coverage guard enforces this).

Each application module:

- Owns its transaction boundary (`db.transaction(async tx => ...)`).
- Calls `writeAuditLog(tx, ...)` for every mutation it makes.
- Validates tenant scope (`before.accountId === input.accountId` checks).
- Throws on invariant violations; the caller (action / route handler) translates to a user-facing error.

Layout is one folder per business capability:

```
application/
├── auth/provision.ts                  Clerk webhook → account+user setup (with optional invitation handoff)
├── subscriptions/index.ts             Create/update/cancel subscription + emit renewal event
├── savings/index.ts                   Upsert savings record from a decision
├── integrations/index.ts              Upsert/disable Slack + ICS integrations
└── invitations/index.ts               Create / revoke / accept invitations
```

When a use case needs a new dependency (an HTTP client, a key-management call, etc.), add it under `infrastructure/` and import it here. Don't reach for `fetch` directly.
