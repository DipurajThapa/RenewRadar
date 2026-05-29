/**
 * Canonical writer for the vendor-side audit log.
 *
 * Parallel to `src/server/infrastructure/audit-log/writer.ts` (customer side),
 * but scoped to `vendor_org_id`. We don't reuse `auditLogTable` because it is
 * `account_id`-scoped (not nullable) and vendor events don't belong to any
 * customer account.
 *
 * Same invariants as the customer-side writer:
 *
 *   - Takes a `tx` so the audit row is committed atomically with the mutation
 *     it describes. Half-applied state with no audit trail is the failure
 *     mode this protects against.
 *
 *   - `before`/`after` stored as raw JSON. We don't diff here; that's a
 *     read-side concern.
 *
 *   - Action strings are enumerated via `VENDOR_AUDIT_ACTIONS`. New actions
 *     land here first, then in the application module.
 *
 * The audit-log coverage test
 * (`src/server/infrastructure/audit-log/__tests__/coverage.test.ts`) is
 * extended to recognize `writeVendorAuditLog(` as a valid audit call so
 * vendor-side application modules pass the same structural check.
 */
import type { db as defaultDb } from "@server/infrastructure/db/client";
import { vendorAuditLogTable } from "@server/infrastructure/db/schema";

/**
 * Enumerable, type-safe vendor-side action labels. Add new actions here
 * when you add new mutating code paths on the vendor portal.
 */
export const VENDOR_AUDIT_ACTIONS = {
  // T4.10 Slice 1 — identity + auth
  vendorOrgRegistered: "vendor_org.registered",
  vendorUserCreated: "vendor_user.created",
  vendorMagicLinkIssued: "vendor_user.magic_link_issued",
  vendorMagicLinkRedeemed: "vendor_user.magic_link_redeemed",
  vendorSessionStarted: "vendor_user.session_started",
  vendorSessionEnded: "vendor_user.session_ended",
  vendorSessionRevoked: "vendor_user.session_revoked",
  vendorUserEmailVerified: "vendor_user.email_verified",
  // T4.10 Slice 2 — domain verification
  vendorDomainVerificationStarted: "vendor_org.domain_verification_started",
  vendorDomainVerified: "vendor_org.domain_verified",
  vendorDomainVerificationFailed: "vendor_org.domain_verification_failed",
  vendorDomainVerifiedManually: "vendor_org.domain_verified_manually",
  // T4.10 Slice 3 — connections
  vendorConnectionRequested: "vendor_connection.requested",
  vendorConnectionAccepted: "vendor_connection.accepted",
  vendorConnectionDeclined: "vendor_connection.declined",
  vendorConnectionBlocked: "vendor_connection.blocked",
  // T4.10 Slice 4 — announcements
  vendorAnnouncementCreated: "vendor_announcement.created",
  vendorAnnouncementPublished: "vendor_announcement.published",
  // T4.10 Slice 5/6 — customer actions on deliveries
  vendorAnnouncementAccepted: "vendor_announcement.accepted",
  vendorAnnouncementDismissed: "vendor_announcement.dismissed",
  vendorAnnouncementReported: "vendor_announcement.reported",
  // T4.10 Slice 6 — staff trust actions on a vendor org
  vendorOrgSuspended: "vendor_org.suspended",
  vendorOrgReinstated: "vendor_org.reinstated",
} as const;

export type VendorAuditAction =
  (typeof VENDOR_AUDIT_ACTIONS)[keyof typeof VENDOR_AUDIT_ACTIONS];

type DrizzleTx = Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];
/** Anything you can call `.insert()` on — the top-level db OR a tx. */
export type VendorAuditTx = DrizzleTx | typeof defaultDb;

export type WriteVendorAuditLogInput = {
  /** Vendor org scope. Required even when actor is null (system events). */
  vendorOrgId: string;
  /** Null for system-initiated events (e.g. cron, rate-limit emit). */
  actorVendorUserId: string | null;
  action: VendorAuditAction;
  target: {
    entityType: string;
    entityId: string;
  };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export async function writeVendorAuditLog(
  tx: VendorAuditTx,
  input: WriteVendorAuditLogInput
): Promise<void> {
  await tx.insert(vendorAuditLogTable).values({
    vendorOrgId: input.vendorOrgId,
    actorVendorUserId: input.actorVendorUserId,
    action: input.action,
    targetEntityType: input.target.entityType,
    targetEntityId: input.target.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
