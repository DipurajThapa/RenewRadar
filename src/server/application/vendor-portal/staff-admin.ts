/**
 * T4.10 Slice 6 — staff trust administration for vendor orgs.
 *
 * Renewal Radar operators (staff) can:
 *   - See every vendor org with its verification state, connected-customer
 *     count, and complaint (report) count.
 *   - Suspend a vendor org (e.g. too many spam complaints) — blocks sign-in
 *     and publishing immediately.
 *   - Reinstate a suspended vendor org.
 *
 * Suspend/reinstate are SOFT — they only flip `status`, never delete the org
 * (per the project-wide "never delete" rule). Audit goes to vendor_audit_log.
 */
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorAnnouncementDeliveriesTable,
  vendorConnectionsTable,
  vendorOrgsTable,
  type VendorOrg,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";

export class StaffVendorAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffVendorAdminError";
  }
}

export type StaffVendorOrgRow = VendorOrg & {
  connectedCustomers: number;
  complaintCount: number;
};

/** All vendor orgs (incl. suspended/archived) with trust signals, for staff. */
export async function listVendorOrgsForStaff(): Promise<StaffVendorOrgRow[]> {
  const orgs = await db
    .select()
    .from(vendorOrgsTable)
    .orderBy(desc(vendorOrgsTable.createdAt));
  if (orgs.length === 0) return [];

  const connRows = await db
    .select({
      vendorOrgId: vendorConnectionsTable.vendorOrgId,
      count: sql<number>`count(*)::int`,
    })
    .from(vendorConnectionsTable)
    .where(eq(vendorConnectionsTable.status, "connected"))
    .groupBy(vendorConnectionsTable.vendorOrgId);
  const connByOrg = new Map(connRows.map((r) => [r.vendorOrgId, r.count]));

  const complaintRows = await db
    .select({
      vendorOrgId: vendorAnnouncementDeliveriesTable.vendorOrgId,
      count: sql<number>`count(*)::int`,
    })
    .from(vendorAnnouncementDeliveriesTable)
    .where(isNotNull(vendorAnnouncementDeliveriesTable.reportedAt))
    .groupBy(vendorAnnouncementDeliveriesTable.vendorOrgId);
  const complaintsByOrg = new Map(
    complaintRows.map((r) => [r.vendorOrgId, r.count])
  );

  return orgs.map((o) => ({
    ...o,
    connectedCustomers: connByOrg.get(o.id) ?? 0,
    complaintCount: complaintsByOrg.get(o.id) ?? 0,
  }));
}

export async function suspendVendorOrg(input: {
  vendorOrgId: string;
  reason: string;
}): Promise<VendorOrg> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(vendorOrgsTable)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(vendorOrgsTable.id, input.vendorOrgId))
      .returning();
    if (!updated) throw new StaffVendorAdminError("Vendor org not found.");

    await writeVendorAuditLog(tx, {
      vendorOrgId: updated.id,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorOrgSuspended,
      target: { entityType: "vendor_org", entityId: updated.id },
      after: { reason: input.reason },
    });
    return updated;
  });
}

export async function reinstateVendorOrg(input: {
  vendorOrgId: string;
}): Promise<VendorOrg> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, input.vendorOrgId))
      .limit(1);
    if (!org) throw new StaffVendorAdminError("Vendor org not found.");
    if (org.status !== "suspended") {
      throw new StaffVendorAdminError("Only a suspended vendor can be reinstated.");
    }
    // Restore to active if the domain was verified, else back to pending.
    const nextStatus = org.domainVerifiedAt ? "active" : "pending";

    const [updated] = await tx
      .update(vendorOrgsTable)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(vendorOrgsTable.id, input.vendorOrgId))
      .returning();

    await writeVendorAuditLog(tx, {
      vendorOrgId: org.id,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorOrgReinstated,
      target: { entityType: "vendor_org", entityId: org.id },
      after: { status: nextStatus },
    });
    return updated ?? org;
  });
}
