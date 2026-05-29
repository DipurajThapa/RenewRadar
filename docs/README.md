# Renewal Radar — Documentation Index

| Audience | Start here |
|---|---|
| **New user** | [user-manual.md](user-manual.md) — guided tour of every workflow |
| **New engineer** | [development/getting-started.md](development/getting-started.md) |
| **Architect / reviewer** | [architecture/overview.md](architecture/overview.md), [architecture/layers.md](architecture/layers.md), [architecture/technical-specification.md](architecture/technical-specification.md), [architecture/adr/](architecture/adr/) |
| **DevOps** | [deployment/production.md](deployment/production.md) |
| **On-call** | [runbooks/](runbooks/) |
| **Product** | [product/implementation-plan.md](product/implementation-plan.md), [product/strategy-wedge-and-moat.md](product/strategy-wedge-and-moat.md) |

## What lives where

- **`architecture/`** — How the code is layered, the rules that hold across layers, and the Architecture Decision Records (ADRs) for non-obvious calls.
- **`deployment/`** — How to deploy to production.
- **`development/`** — How to run the app locally + the developer runbook.
- **`runbooks/`** — On-call procedures: data recovery, monitoring, founding-customer migration, launch checklist.
- **`product/`** — The implementation plan (canonical roadmap reference).

## What does NOT live here

- Deep API contracts — the public API + key auth exist (`/api/v1`); a full OpenAPI spec will land in an `api/` subfolder when the surface stabilizes. The day-to-day contract is still the TypeScript boundary between server actions / route handlers and their callers.

> The **[user manual](user-manual.md)** is the new-user help doc; longer-form marketing help also lives on the marketing site.
