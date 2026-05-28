# ADR 0001 — Single Next.js monolith, not `apps/frontend` + `apps/backend`

**Status:** Accepted · **Date:** 2026-05-28

## Context

A reasonable default for SaaS engineering is to split a codebase into a frontend SPA and a backend API, often arranged as a monorepo (`apps/frontend/`, `apps/backend/`, `packages/shared/`). This pattern enables independent deploys, clear ownership boundaries, and language flexibility.

Renewal Radar is built on Next.js 14 with the App Router. The framework's central value propositions — React Server Components, server actions, file-based routing, edge middleware — **depend on client and server code living in the same tree** and being co-located by route.

We had to choose: split anyway (giving up Next.js's value), or keep a single project and find the layering inside it.

## Decision

**Single Next.js monolith** with strict internal layering inside `src/`:

- `src/server/{domain,application,infrastructure,middleware,jobs}/` — all server-only code
- `src/ui/{components,features,hooks,design-system}/` — all React UI
- `src/shared/{validation,utils,types}/` — bundle-safe shared code
- `src/app/` — Next.js routing (pages, route handlers, server actions)

Layers and their allowed imports are documented in [layers.md](../layers.md). The boundary is enforceable by ESLint (`eslint-plugin-boundaries`) once we add the rule.

## Consequences

- **+** No deployment dance — one Vercel project, one build, one runtime config.
- **+** Type safety is end-to-end without a contract layer; the server action's argument type is also the client form's expected payload.
- **+** RSC, server actions, edge middleware, and image optimization all work as designed.
- **+** Refactoring is cheap: moving a function between layers is `git mv` + updating one import.
- **−** New engineers used to `apps/frontend + apps/backend` have to be told how this layout maps to the conventional one (this ADR is that document).
- **−** The boundary is a convention until we add the ESLint rule; without it, a lazy import from `ui/` into `server/` is technically possible. The bundler will catch it eventually (it'll fail to compile), but we want it to fail at lint time.

## What this rules out

- A separate Vite + React SPA.
- A separate Express + tRPC API.
- A separate mobile app (React Native) sharing code via `packages/shared/` — when that's needed, we extract `shared/` into a real package.

## Revisit when

- We add a native mobile app and need a versioned API contract.
- The server side grows large enough that build times exceed ~5 minutes.
- We hire a backend team that wants to deploy backend services independently of frontend releases.
