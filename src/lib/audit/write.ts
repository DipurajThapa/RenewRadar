/**
 * Canonical writer for the audit_log table.
 *
 * Every mutation that changes a business-critical row (`subscription`,
 * `renewal_event`, `account`, `user`, `vendor`, `invitation`, `savings_record`,
 * `integration`, AI-extracted-field applications) MUST call this from within
 * its transaction. Direct `tx.insert(auditLogTable)` calls are forbidden — the
 * coverage test (`src/lib/audit/__tests__/coverage.test.ts`) will fail the
 * build if a mutating actions file is added without going through this helper
 * or an audit-log-encapsulating mutation module.
 *
 * Design notes:
 *
 * - Takes a `tx` (a Drizzle transaction or the top-level `db`) so callers can
 *   compose the audit write with their mutation in the same transaction.
 *   Half-applied state with no audit trail is the failure mode we are
 *   protecting against; making `tx` non-optional makes that hard to write by
 *   accident.
 *
 * - `before` and `after` are stored as raw JSON blobs. We do NOT try to diff
 *   them here — that's a read-side concern. Keep this writer dumb and fast.
 *
 * - The `action` string follows the convention `<entity>.<verb>` in
 *   past-tense: `subscription.created`, `account.updated`,
 *   `renewal_decision.logged`, etc. This file maintains the AUDIT_ACTIONS
 *   constant so the set is enumerable; new actions land here first.
 */
import type { db as defaultDb } from "@/lib/db";
import { auditLogTable } from "@/lib/db/schema";

/**
 * Enumerable, type-safe action labels. Add new actions here when you add new
 * mutating code paths. The coverage test asserts only these strings are used.
 */
export const AUDIT_ACTIONS = {
  // subscriptions
  subscriptionCreated: "subscription.created",
  subscriptionUpdated: "subscription.updated",
  subscriptionCancelled: "subscription.cancelled",
  subscriptionOwnerChanged: "subscription.owner_changed",
  // renewal events
  renewalDecisionLogged: "renewal_decision.logged",
  // account-level
  accountUpdated: "account.updated",
  // notification preferences
  notificationPrefsUpdated: "notification_prefs.updated",
  // savings records
  savingsRecordCreated: "savings_record.created",
  savingsRecordUpdated: "savings_record.updated",
  // approvals-lite
  renewalDecisionApproved: "renewal_decision.approved",
  renewalDecisionRejected: "renewal_decision.rejected",
  approvalsToggled: "account.approvals_toggled",
  // retention
  auditLogPurged: "audit_log.purged",
  // invitations
  invitationCreated: "invitation.created",
  invitationRevoked: "invitation.revoked",
  invitationAccepted: "invitation.accepted",
  // users
  userRoleChanged: "user.role_changed",
  // integrations
  integrationConfigured: "integration.configured",
  integrationDisabled: "integration.disabled",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

type DrizzleTx = Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];
/** Anything you can call `.insert()` on — the top-level db OR a tx. */
export type AuditTx = DrizzleTx | typeof defaultDb;

export type WriteAuditLogInput = {
  /** Tenant scope. Required even when actor is null (e.g. system jobs). */
  accountId: string;
  /** Null for system-initiated changes (cron jobs, webhooks). */
  actorUserId: string | null;
  action: AuditAction;
  target: {
    entityType: string;
    entityId: string;
  };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function writeAuditLog(
  tx: AuditTx,
  input: WriteAuditLogInput
): Promise<void> {
  await tx.insert(auditLogTable).values({
    accountId: input.accountId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetEntityType: input.target.entityType,
    targetEntityId: input.target.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
