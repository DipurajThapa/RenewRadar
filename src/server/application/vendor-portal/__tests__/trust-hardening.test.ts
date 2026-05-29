/**
 * T4.10 Slice 6 — trust-hardening contract tests.
 *
 * Invariants:
 *   - reportVendorUpdate flags the delivery (reportedAt + reason) + audit.
 *   - listVendorOrgsForStaff aggregates connected-customer + complaint counts.
 *   - suspendVendorOrg → status suspended (+ audit); suspended vendor can't
 *     publish (Slice 4 gate) and can't sign in (Slice 1 gate, covered there).
 *   - reinstateVendorOrg → active when domain was verified.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  usersTable,
  vendorAnnouncementDeliveriesTable,
  vendorAuditLogTable,
  vendorOrgsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import { requestMagicLink } from "@server/application/vendor-portal";
import { manuallyVerifyDomain } from "@server/application/vendor-portal/domain-verification";
import {
  acceptConnection,
  requestConnection,
} from "@server/application/vendor-portal/connections";
import {
  createAnnouncement,
  publishAnnouncement,
  VendorAnnouncementError,
} from "@server/application/vendor-portal/announcements";
import {
  listVendorUpdates,
  reportVendorUpdate,
} from "@server/application/vendor-portal/customer-inbox";
import {
  listVendorOrgsForStaff,
  reinstateVendorOrg,
  suspendVendorOrg,
} from "@server/application/vendor-portal/staff-admin";
import { VENDOR_AUDIT_ACTIONS } from "@server/infrastructure/vendor-audit-log/writer";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

async function setup() {
  const v = await requestMagicLink({ email: "a@trustco.io" });
  await manuallyVerifyDomain({ vendorOrgId: v.vendorOrg.id, note: "t" });
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Cust", billingEmail: "c@c.test" })
    .returning();
  const [owner] = await db
    .insert(usersTable)
    .values({
      accountId: account!.id,
      clerkUserId: `clerk_${account!.id}`,
      workEmail: "owner@c.test",
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ accountId: account!.id, name: "TrustCo", website: "https://trustco.io" })
    .returning();
  const conn = await requestConnection({
    accountId: account!.id,
    vendorOrgId: v.vendorOrg.id,
    customerVendorId: vendor!.id,
    requestedByUserId: owner!.id,
  });
  await acceptConnection({ connectionId: conn.id, vendorOrgId: v.vendorOrg.id, vendorUserId: v.vendorUser.id });
  const draft = await createAnnouncement({
    vendorOrgId: v.vendorOrg.id,
    vendorUserId: v.vendorUser.id,
    kind: "general",
    title: "Spammy",
    body: "Buy now!",
  });
  await publishAnnouncement({ announcementId: draft.id, vendorOrgId: v.vendorOrg.id, vendorUserId: v.vendorUser.id });
  const [update] = await listVendorUpdates(account!.id);
  return {
    orgId: v.vendorOrg.id,
    vendorUserId: v.vendorUser.id,
    accountId: account!.id,
    ownerId: owner!.id,
    deliveryId: update!.deliveryId,
  };
}

describe("reportVendorUpdate", () => {
  it("flags the delivery + writes an audit row", async () => {
    const s = await setup();
    await reportVendorUpdate({
      accountId: s.accountId,
      deliveryId: s.deliveryId,
      userId: s.ownerId,
      reason: "This is spam, not a real notice.",
    });

    const [delivery] = await db
      .select()
      .from(vendorAnnouncementDeliveriesTable)
      .where(eq(vendorAnnouncementDeliveriesTable.id, s.deliveryId));
    expect(delivery?.reportedAt).toBeInstanceOf(Date);
    expect(delivery?.reportReason).toContain("spam");

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, s.orgId));
    expect(audit.map((a) => a.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorAnnouncementReported
    );
  });

  it("requires a reason", async () => {
    const s = await setup();
    await expect(
      reportVendorUpdate({
        accountId: s.accountId,
        deliveryId: s.deliveryId,
        userId: s.ownerId,
        reason: "   ",
      })
    ).rejects.toThrow();
  });
});

describe("listVendorOrgsForStaff", () => {
  it("aggregates connected-customer + complaint counts", async () => {
    const s = await setup();
    await reportVendorUpdate({
      accountId: s.accountId,
      deliveryId: s.deliveryId,
      userId: s.ownerId,
      reason: "spam",
    });
    const orgs = await listVendorOrgsForStaff();
    const row = orgs.find((o) => o.id === s.orgId);
    expect(row?.connectedCustomers).toBe(1);
    expect(row?.complaintCount).toBe(1);
  });
});

describe("suspend / reinstate", () => {
  it("suspends and blocks publishing", async () => {
    const s = await setup();
    await suspendVendorOrg({ vendorOrgId: s.orgId, reason: "spam complaints" });

    const [org] = await db
      .select()
      .from(vendorOrgsTable)
      .where(eq(vendorOrgsTable.id, s.orgId));
    expect(org?.status).toBe("suspended");

    // can't publish while suspended
    const draft = await createAnnouncement({
      vendorOrgId: s.orgId,
      vendorUserId: s.vendorUserId,
      kind: "general",
      title: "Nope",
      body: "b",
    });
    await expect(
      publishAnnouncement({ announcementId: draft.id, vendorOrgId: s.orgId, vendorUserId: s.vendorUserId })
    ).rejects.toBeInstanceOf(VendorAnnouncementError);

    const audit = await db
      .select()
      .from(vendorAuditLogTable)
      .where(eq(vendorAuditLogTable.vendorOrgId, s.orgId));
    expect(audit.map((a) => a.action)).toContain(
      VENDOR_AUDIT_ACTIONS.vendorOrgSuspended
    );
  });

  it("reinstates a suspended, previously-verified org back to active", async () => {
    const s = await setup();
    await suspendVendorOrg({ vendorOrgId: s.orgId, reason: "x" });
    const reinstated = await reinstateVendorOrg({ vendorOrgId: s.orgId });
    expect(reinstated.status).toBe("active");
  });

  it("refuses to reinstate a non-suspended org", async () => {
    const s = await setup();
    await expect(reinstateVendorOrg({ vendorOrgId: s.orgId })).rejects.toThrow();
  });
});
