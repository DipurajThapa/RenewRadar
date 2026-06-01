/**
 * Canonical writer for the audit_log table.
 *
 * Every mutation that changes a business-critical row (`subscription`,
 * `renewal_event`, `account`, `user`, `vendor`, `invitation`, `savings_record`,
 * `integration`, AI-extracted-field applications) MUST call this from within
 * its transaction. Direct `tx.insert(auditLogTable)` calls are forbidden — the
 * coverage test at `src/server/infrastructure/audit-log/__tests__/coverage.test.ts`
 * fails the build if a mutating actions file is added without going through
 * this helper or an audit-log-encapsulating application module.
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
import type { db as defaultDb } from "@server/infrastructure/db/client";
import { auditLogTable } from "@server/infrastructure/db/schema";

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
  savingsRecordReconciled: "savings_record.reconciled",
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
  // documents + AI extraction (Phase C)
  documentUploaded: "document.uploaded",
  documentDeleted: "document.deleted",
  extractionStarted: "extraction.started",
  extractionCompleted: "extraction.completed",
  extractionFailed: "extraction.failed",
  extractedFieldAccepted: "extracted_field.accepted",
  extractedFieldEdited: "extracted_field.edited",
  extractedFieldRejected: "extracted_field.rejected",
  extractedFieldApplied: "extracted_field.applied",
  // Confidence-gated AI auto-apply + its one-click undo (Gate 2b)
  extractedFieldAutoApplied: "extracted_field.auto_applied",
  extractedFieldReverted: "extracted_field.reverted",
  // data export (GDPR-style account download)
  accountDataExported: "account.data_exported",
  // user lifecycle (P7.2 — archive replaces hard delete; restore brings back)
  userArchived: "user.archived",
  userRestored: "user.restored",
  // staff support sessions (T4.1 — concierge onboarding)
  supportSessionStarted: "support.session_started",
  supportSessionEnded: "support.session_ended",
  staffActedOnAccount: "support.staff_acted",
  // public API (T4.6)
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
  apiRequest: "api.request",
  // procurement intake (T4.11)
  intakeRequestSubmitted: "intake_request.submitted",
  intakeRequestApproved: "intake_request.approved",
  intakeRequestDenied: "intake_request.denied",
  intakeRequestDuplicate: "intake_request.duplicate",
  intakeRequestWithdrawn: "intake_request.withdrawn",
  // wedge PoC — spend ingestion + renewal reasoning
  spendConnectionConfigured: "spend_connection.configured",
  spendConnectionDisconnected: "spend_connection.disconnected",
  recurringChargeConfirmed: "recurring_charge.confirmed",
  recurringChargeDismissed: "recurring_charge.dismissed",
  renewalBriefGenerated: "renewal_brief.generated",
  // A3 — safe-agent internal renewal-notice draft
  renewalNoticeDrafted: "renewal_notice.drafted",
  renewalNoticeEdited: "renewal_notice.edited",
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
