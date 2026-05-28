# ADR 0003 — Single `writeAuditLog` helper + coverage-guarded invariant

**Status:** Accepted · **Date:** 2026-05-28

## Context

Renewal Radar must answer "who changed what, when" for every mutation against a customer-owned row. The audit log is one of the artifacts that paid customers actually look at (`/settings/audit`), and it's the basis for the retention story (tier-based purge cron) and the security page commitment.

Two failure modes are common in audit-log designs:

1. **Drift.** A new code path is added that mutates a row and forgets to write the log entry. Months later, an investigation finds the gap.
2. **Inconsistency.** Different call sites use slightly different action strings (`subscription.updated` vs `update_subscription` vs `Subscription Update`), making the log unfilterable.

## Decision

**Single canonical writer + enumerated action strings + mechanical coverage guard.**

1. **One writer.** `src/server/infrastructure/audit-log/writer.ts` exports `writeAuditLog(tx, {accountId, actorUserId, action, target, before, after})`. It is the only file in the codebase allowed to call `tx.insert(auditLogTable)`. The `tx` parameter is non-optional — every audit write composes with its mutation in the same transaction, eliminating "mutation succeeded but audit log didn't" failure modes.
2. **Enumerated actions.** `writer.ts` also exports `AUDIT_ACTIONS`, a `const` object whose values are the only legal action strings (e.g. `subscription.created`, `renewal_decision.logged`, `account.approvals_toggled`, …). The `AuditAction` type is `(typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]` so TypeScript catches typos at compile time.
3. **Coverage guard.** `src/server/infrastructure/audit-log/__tests__/coverage.test.ts` runs four checks against the whole codebase:
   - Every `actions.ts` file either imports `writeAuditLog` directly or imports from `@server/application/*` (which is required to call it).
   - No file outside the writer touches `auditLogTable` directly.
   - Every file under `server/application/**/*.ts` that mutates (`tx.update/insert/delete`) also calls `writeAuditLog`.
   - `AUDIT_ACTIONS` is defined only in the canonical writer.
4. **Exemption list.** Per-user read-state mutations (e.g. mark-notification-read) are exempt — they don't change business-critical data. The list lives in `AUDIT_EXEMPT_ACTIONS_FILES` at the top of the coverage test, every entry annotated with a one-line justification.

## Coverage enforcement examples

- During this refactor, the coverage guard caught me adding `saveNotificationPrefsAction` without an audit-log write. Fix landed in the same commit.
- When I added the audit-retention cron, the guard caught the cron writing to `auditLogTable` directly (instead of through the helper). I changed it to call `writeAuditLog` and the test re-passed.

These are the kind of catches the helper was designed to make automatic.

## Consequences

- **+** A new mutation cannot ship without a log entry — the build fails.
- **+** Action strings are searchable and filterable because they're enumerated.
- **+** Adding a new audit action is one line in `AUDIT_ACTIONS` + the call site.
- **+** The before/after JSON columns mean we can inspect any change without a separate event-sourcing layer.
- **−** The coverage test relies on a small set of grep heuristics, not full AST analysis. It's possible (but very awkward) to write code that fools it. The next layer of safety is the security review on the PR.
- **−** The `tx` parameter being non-optional means a future "fire-and-forget audit log" pattern requires an explicit decision. Today we don't have one; we'd revisit if a perf hotspot needed it.

## What this rules out

- Audit logs written via a hook or middleware that wraps the action. Hooks compose poorly with transactions and make the failure mode (mutation succeeds, log doesn't) easy to write.
- Free-form action strings. The cost of typing two more characters to add a key to `AUDIT_ACTIONS` is lower than the cost of an unfilterable log.

## Revisit when

- We need cross-region audit forwarding (e.g. to a dedicated SIEM). The writer is the point where that fan-out would land.
- We hit the per-account write throughput that makes the synchronous in-transaction write a hotspot. (Not foreseeable at V1 scale.)
