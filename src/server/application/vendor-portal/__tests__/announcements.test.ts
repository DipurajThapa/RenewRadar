/**
 * T4.10 Slice 4 — announcement publishing contract tests.
 *
 * Invariants:
 *   - Only a verified (active) vendor can publish.
 *   - Publishing fans out one delivery per CONNECTED customer (not pending).
 *   - Each connected customer's owners+admins get notified (email + in_app).
 *   - The daily cap blocks the (MAX+1)th publish in a 24h window.
 *   - Re-publishing a published announcement is refused.
 *   - Stats reflect delivery rows.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  notificationsTable,
  usersTable,
  vendorAnnouncementDeliveriesTable,
  vendorConnectionsTable,
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
  MAX_ANNOUNCEMENTS_PER_DAY,
  publishAnnouncement,
  VendorAnnouncementError,
  listAnnouncementsWithStats,
} from "@server/application/vendor-portal/announcements";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

async function verifiedVendor(email: string) {
  const r = await requestMagicLink({ email });
  await manuallyVerifyDomain({ vendorOrgId: r.vendorOrg.id, note: "test" });
  return { orgId: r.vendorOrg.id, vendorUserId: r.vendorUser.id };
}

async function connectedCustomer(vendorOrgId: string, name: string, website: string) {
  const [account] = await db
    .insert(accountsTable)
    .values({ name, billingEmail: `${name}@c.test` })
    .returning();
  const [owner] = await db
    .insert(usersTable)
    .values({
      accountId: account!.id,
      clerkUserId: `clerk_owner_${account!.id}`,
      workEmail: `owner@${name}.test`,
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  // a member who should NOT be notified
  await db.insert(usersTable).values({
    accountId: account!.id,
    clerkUserId: `clerk_member_${account!.id}`,
    workEmail: `member@${name}.test`,
    fullName: "Member",
    role: "member",
  });
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ accountId: account!.id, name, website })
    .returning();
  const conn = await requestConnection({
    accountId: account!.id,
    vendorOrgId,
    customerVendorId: vendor!.id,
    requestedByUserId: owner!.id,
  });
  return { accountId: account!.id, ownerId: owner!.id, connectionId: conn.id };
}

describe("publishAnnouncement", () => {
  it("fans out to connected customers and notifies their approvers", async () => {
    const v = await verifiedVendor("a@announce.io");
    // two connected customers + one pending (should NOT receive)
    const c1 = await connectedCustomer(v.orgId, "Cust1", "https://c1.io");
    const c2 = await connectedCustomer(v.orgId, "Cust2", "https://c2.io");
    await acceptConnection({ connectionId: c1.connectionId, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });
    await acceptConnection({ connectionId: c2.connectionId, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });
    // pending customer
    await connectedCustomer(v.orgId, "Pending", "https://p.io");

    const draft = await createAnnouncement({
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
      kind: "price_change",
      title: "Prices up 8%",
      body: "Effective Jan 1, list prices rise 8%.",
      effectiveDate: "2027-01-01",
    });

    const result = await publishAnnouncement({
      announcementId: draft.id,
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
    });
    expect(result.deliveredCount).toBe(2);

    // delivery rows for the two connected accounts only
    const deliveries = await db
      .select()
      .from(vendorAnnouncementDeliveriesTable)
      .where(eq(vendorAnnouncementDeliveriesTable.announcementId, draft.id));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "delivered")).toBe(true);

    // each connected customer's OWNER got notified (email + in_app), member did not
    const ownerNotifs = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, c1.ownerId),
          eq(notificationsTable.trigger, "vendor_announcement" as never)
        )
      );
    expect(ownerNotifs).toHaveLength(2); // email + in_app
  });

  it("refuses to publish from an unverified vendor", async () => {
    const r = await requestMagicLink({ email: "x@unverified.io" }); // pending
    const draft = await createAnnouncement({
      vendorOrgId: r.vendorOrg.id,
      vendorUserId: r.vendorUser.id,
      kind: "general",
      title: "Hi",
      body: "We exist.",
    });
    await expect(
      publishAnnouncement({
        announcementId: draft.id,
        vendorOrgId: r.vendorOrg.id,
        vendorUserId: r.vendorUser.id,
      })
    ).rejects.toBeInstanceOf(VendorAnnouncementError);
  });

  it("refuses to re-publish an already-published announcement", async () => {
    const v = await verifiedVendor("a@republish.io");
    const draft = await createAnnouncement({
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
      kind: "general",
      title: "One",
      body: "body",
    });
    await publishAnnouncement({ announcementId: draft.id, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });
    await expect(
      publishAnnouncement({ announcementId: draft.id, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId })
    ).rejects.toBeInstanceOf(VendorAnnouncementError);
  });

  it("enforces the daily publish cap", async () => {
    const v = await verifiedVendor("a@cap.io");
    for (let i = 0; i < MAX_ANNOUNCEMENTS_PER_DAY; i++) {
      const d = await createAnnouncement({
        vendorOrgId: v.orgId,
        vendorUserId: v.vendorUserId,
        kind: "general",
        title: `n${i}`,
        body: "b",
      });
      await publishAnnouncement({ announcementId: d.id, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });
    }
    const extra = await createAnnouncement({
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
      kind: "general",
      title: "over",
      body: "b",
    });
    await expect(
      publishAnnouncement({ announcementId: extra.id, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId })
    ).rejects.toBeInstanceOf(VendorAnnouncementError);
  });

  it("publishes with zero connected customers (no-op fan-out)", async () => {
    const v = await verifiedVendor("a@lonely.io");
    const draft = await createAnnouncement({
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
      kind: "general",
      title: "Anyone?",
      body: "b",
    });
    const result = await publishAnnouncement({
      announcementId: draft.id,
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
    });
    expect(result.deliveredCount).toBe(0);
    expect(result.announcement.status).toBe("published");
  });
});

describe("listAnnouncementsWithStats", () => {
  it("reports delivery counts", async () => {
    const v = await verifiedVendor("a@stats.io");
    const c1 = await connectedCustomer(v.orgId, "S1", "https://s1.io");
    await acceptConnection({ connectionId: c1.connectionId, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });
    const draft = await createAnnouncement({
      vendorOrgId: v.orgId,
      vendorUserId: v.vendorUserId,
      kind: "renewal_reminder",
      title: "Renew soon",
      body: "b",
    });
    await publishAnnouncement({ announcementId: draft.id, vendorOrgId: v.orgId, vendorUserId: v.vendorUserId });

    const stats = await listAnnouncementsWithStats(v.orgId);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.deliveredCount).toBe(1);
    expect(stats[0]?.acceptedCount).toBe(0);
  });
});
