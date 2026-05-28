# ADR 0002 — Tenant isolation via `account_id` + per-query filtering

**Status:** Accepted · **Date:** 2026-05-28

## Context

Renewal Radar is multi-tenant from day one. A customer account is the smallest unit of isolation; users belong to exactly one account. The dataset is small enough per tenant (≤500 active subscriptions on the largest tier) that a shared-database design is appropriate. Per-tenant databases would be operationally expensive and offer no real benefit at this scale.

We need a tenancy model that makes "a query that returns another account's data" impossible to write by accident, not just discouraged.

## Decision

**Single database, every customer-owned row carries `account_id`, every query and every mutation filters on it.**

Mechanics:

1. **Schema rule.** Every table that holds customer data has `account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE` plus an `(account_id, …)` index on the column it's most often queried with.
2. **Resolver rule.** The currently-authenticated user's `accountId` is resolved server-side from the Clerk session via `getCurrentAccountAndUser()`. It is never accepted from a request header, URL parameter, or form field that a client could forge.
3. **Query rule.** Every Drizzle query in `server/infrastructure/db/repositories/` includes `eq(table.accountId, accountId)` in its `where` clause.
4. **Mutation rule.** Every update / delete loads the row first, asserts `before.accountId === input.accountId`, and throws otherwise. The error message is the same whether the row doesn't exist or it belongs to another tenant — both surface as "not found" to the caller (no enumeration leak).
5. **Cross-table joins.** When a query joins another table, both sides are scoped (`eq(table1.accountId, accountId) AND eq(table2.accountId, accountId)`). The redundancy is deliberate: if a future table loses its FK constraint, the join still filters correctly.

## Coverage enforcement

`src/server/infrastructure/db/repositories/__tests__/tenant-isolation.test.ts`:

- Seeds two accounts with overlapping shapes (vendor "A" vs vendor "B", same product names, same dates).
- For every public function in every repository, asserts the function scoped to account A returns no rows from account B and vice versa.
- For every public mutation, asserts a cross-account call throws.
- A **coverage guard** test reads `repositories/` and fails if a query module exists without a matching `describe("queries/<name>", …)` block in this test file.

The coverage guard means a new repository file cannot be merged without a tenant-isolation test alongside it.

## Consequences

- **+** A correct query is the easy path; an incorrect query is verbose and fails the test.
- **+** The boundary is mechanically checked on every commit.
- **+** Switching to per-tenant databases later is straightforward — the `accountId` filter becomes redundant rather than wrong.
- **−** Every query is two characters longer than it would be without the filter. Negligible.
- **−** The mutation defense-in-depth check (the `before.accountId !== input.accountId` throw) is technically redundant with the resolver pattern, but we keep it because it costs nothing and protects against a future refactor that bypasses the resolver.

## What this rules out

- A "current account" stored in an HTTP cookie or header. The session is the source of truth.
- Row-level security (Postgres RLS). Not needed at this scale and adds operational complexity for migrations and ad-hoc queries.

## Revisit when

- We add a per-tenant database tier (Enterprise customers wanting physical isolation).
- We add cross-account features (e.g., a marketplace) where the isolation boundary has legitimate exceptions.
