# Renewal Radar — Documentation Index

| Audience | Start here |
|---|---|
| **New engineer** | [development/getting-started.md](development/getting-started.md) |
| **Architect / reviewer** | [architecture/overview.md](architecture/overview.md), [architecture/layers.md](architecture/layers.md), [architecture/adr/](architecture/adr/) |
| **DevOps** | [deployment/production.md](deployment/production.md) |
| **On-call** | [runbooks/](runbooks/) |
| **Product** | [product/implementation-plan.md](product/implementation-plan.md) |

## What lives where

- **`architecture/`** — How the code is layered, the rules that hold across layers, and the Architecture Decision Records (ADRs) for non-obvious calls.
- **`deployment/`** — How to deploy to production.
- **`development/`** — How to run the app locally + the developer runbook.
- **`runbooks/`** — On-call procedures: data recovery, monitoring, founding-customer migration, launch checklist.
- **`product/`** — The implementation plan (canonical roadmap reference).

## What does NOT live here

- API contracts — there is no external API yet; the contract is the TypeScript boundary between server actions / route handlers and their callers. When we publish a customer-facing API, an `api/` subfolder lands here with the OpenAPI spec.
- User-facing help docs — those live on the marketing site.
