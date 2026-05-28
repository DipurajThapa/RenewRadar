# ADR 0004 — Demo mode (double-guarded local bypass)

**Status:** Accepted · **Date:** 2026-05-28

## Context

Renewal Radar depends on several external services (Clerk for auth, Stripe for billing, Resend for email, Inngest for background jobs). Setting all of these up just to evaluate the product locally — or to review a PR — is friction we don't want to impose on contributors or reviewers.

We need a "no external services" mode that still exercises real code paths, not a separate codebase or a long if-else chain in every component.

## Decision

**Double-guarded environment flag that swaps the auth resolver and middleware behavior at module load.**

```ts
// src/server/middleware/demo-mode.ts
export const isDemoMode =
  process.env.DEMO_MODE === "true" &&
  process.env.NODE_ENV !== "production";
```

The double guard is the safety property: the flag CANNOT enable demo mode in production, even if `DEMO_MODE=true` is misconfigured in the production environment. Either condition disables it.

When `isDemoMode === true`:

- `getCurrentAccountAndUser()` returns the seeded demo account + user instead of looking up via Clerk.
- `src/middleware.ts` short-circuits the Clerk middleware.
- A persistent banner is shown across every app page.
- The seed script (`scripts/db/seed.ts`) pins the demo account and user IDs to the constants `DEMO_ACCOUNT_ID` and `DEMO_USER_ID` so the resolver always finds them.

## Why this is safe

- **The runtime gate is constant-folded at import time.** A production deployment with `DEMO_MODE=true` set still evaluates to `false` because `NODE_ENV !== "production"` is false. The build itself would not contain demo behavior.
- **The seed script refuses to run in production.** It checks `NODE_ENV === "production"` and exits 1.
- **Every demo-mode code path is gated by `isDemoMode`.** No "if we have no user, fall back to demo" patterns — that's how production bypasses get shipped.

## Consequences

- **+** Reviewers can `pnpm dev` against a local Postgres and the seeded demo data, no other setup required.
- **+** PR feedback is fast — anyone can poke the UI without provisioning credentials.
- **+** Demo mode exercises the same RSC + server action + DB code as production.
- **−** Two boot configurations (real + demo) must stay green; the seed script and the resolver must agree on the demo IDs. Drift is caught by the demo banner not appearing or the page erroring.
- **−** The constant-folding behavior assumes `NODE_ENV` is set at build time (Vercel does this; other hosts may not). Documented in deployment runbook.

## What this rules out

- A "demo mode" toggle in the running UI. Demo mode is a build/runtime decision, not user-controllable.
- A separate `package.json` or branch for demos. The codebase is the codebase.

## Revisit when

- We add a public hosted demo at `demo.renewalradar.com` — it would need a different posture (per-visitor sandbox accounts), not the all-users-share-one-account model.
