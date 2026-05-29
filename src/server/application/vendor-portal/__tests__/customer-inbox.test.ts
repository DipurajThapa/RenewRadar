/**
 * T4.10 Slice 5 — customer-side vendor inbox contract tests.
 *
 * Invariants:
 *   - listVendorUpdates returns an account's deliveries with vendor + content.
 *   - markRead flips delivered → read.
 *   - accept stamps the delivery + records a `user_note_added` vendor event on
 *     the matching customer vendor timeline + audit-logs acceptance.
 *   - dismiss stamps dismissed.
 *   - getUnreadVendorUpdateCount counts only delivered (unread).
 *   - Tenant scope: account B can't read/act on account A's deliveries.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  usersTable,
  vendorEventsTable,
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
} from "@server/application/vendor-portal/announcements";
import {
  acceptVendorUpdate,
  dismissVendorUpdate,
  getUnreadVendorUpdateCount,
  listVendorUpdates,
  markVendorUpdateRead,
  VendorInboxError,
} from "@server/application/vendor-portal/customer-inbox";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

/**
 * Full setup: a verified vendor publishes one announcement to one connected
 * customer. Returns the customer ids + the single delivery id.
 */
async function publishedToCustomer(opts?: { website?: string | null }) {
  const v = await requestMagicLink({ email: "a@vendorco.io" });
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
    .values({
      accountId: account!.id,
      name: "VendorCo",
      website: opts?.website === undefined ? "https://vendorco.io" : opts.website,
    })
    .returning();

  const conn = await requestConnection({
    accountId: account!.id,
    vendorOrgId: v.vendorOrg.id,
    customerVendorId: vendor!.id,
    requestedByUserId: owner!.id,
  });
  await acceptConnection({
    connectionId: conn.id,
    vendorOrgId: v.vendorOrg.id,
    vendorUserId: v.vendorUser.id,
  });

  const draft = await createAnnouncement({
    vendorOrgId: v.vendorOrg.id,
    vendorUserId: v.vendorUser.id,
    kind: "price_change",
    title: "Prices rising",
    body: "Up 5% next quarter.",
  });
  await publishAnnouncement({
    announcementId: draft.id,
    vendorOrgId: v.vendorOrg.id,
    vendorUserId: v.vendorUser.id,
  });

  const updates = await listVendorUpdates(account!.id);
  return {
    accountId: account!.id,
    ownerId: owner!.id,
    vendorId: vendor!.id,
    deliveryId: updates[0]!.deliveryId,
  };
}

describe("listVendorUpdates + unread count", () => {
  it("lists the delivered announcement with vendor + content", async () => {
    const s = await publishedToCustomer();
    const updates = await listVendorUpdates(s.accountId);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.vendorName).toBe("Vendorco");
    expect(updates[0]?.title).toBe("Prices rising");
    expect(updates[0]?.kind).toBe("price_change");
    expect(updates[0]?.status).toBe("delivered");
    expect(await getUnreadVendorUpdateCount(s.accountId)).toBe(1);
  });

  it("markRead flips delivered → read and clears the unread count", async () => {
    const s = await publishedToCustomer();
    await markVendorUpdateRead({ accountId: s.accountId, deliveryId: s.deliveryId });
    expect(await getUnreadVendorUpdateCount(s.accountId)).toBe(0);
    const updates = await listVendorUpdates(s.accountId);
    expect(updates[0]?.status).toBe("read");
  });
});

describe("acceptVendorUpdate", () => {
  it("stamps accepted + records a vendor timeline note", async () => {
    const s = await publishedToCustomer();
    await acceptVendorUpdate({
      accountId: s.accountId,
      deliveryId: s.deliveryId,
      userId: s.ownerId,
    });

    const updates = await listVendorUpdates(s.accountId);
    expect(updates[0]?.status).toBe("accepted");

    // a user_note_added event landed on the customer vendor's timeline
    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(
        and(
          eq(vendorEventsTable.accountId, s.accountId),
          eq(vendorEventsTable.vendorId, s.vendorId)
        )
      );
    const note = events.find((e) => e.kind === "user_note_added");
    expect(note).toBeTruthy();
    expect((note?.payload as { note?: string })?.note).toContain("Prices rising");
  });

  it("is idempotent", async () => {
    const s = await publishedToCustomer();
    await acceptVendorUpdate({ accountId: s.accountId, deliveryId: s.deliveryId, userId: s.ownerId });
    await acceptVendorUpdate({ accountId: s.accountId, deliveryId: s.deliveryId, userId: s.ownerId });
    const events = await db
      .select()
      .from(vendorEventsTable)
      .where(eq(vendorEventsTable.vendorId, s.vendorId));
    // only one note despite two accepts
    expect(events.filter((e) => e.kind === "user_note_added")).toHaveLength(1);
  });

  it("accepts gracefully when there's no matching customer vendor row", async () => {
    // website null → no customerVendorId match isn't the issue (we pass
    // customerVendorId explicitly), but if the vendor row is gone the accept
    // must still succeed without a timeline note. Simulate by deleting the
    // vendor row after connection.
    const s = await publishedToCustomer();
    await db.delete(vendorsTable).where(eq(vendorsTable.id, s.vendorId));
    const updated = await acceptVendorUpdate({
      accountId: s.accountId,
      deliveryId: s.deliveryId,
      userId: s.ownerId,
    });
    expect(updated.status).toBe("accepted");
  });
});

describe("dismissVendorUpdate", () => {
  it("stamps dismissed", async () => {
    const s = await publishedToCustomer();
    await dismissVendorUpdate({ accountId: s.accountId, deliveryId: s.deliveryId, userId: s.ownerId });
    const updates = await listVendorUpdates(s.accountId);
    expect(updates[0]?.status).toBe("dismissed");
  });
});

describe("tenant scope", () => {
  it("another account cannot act on this account's delivery", async () => {
    const s = await publishedToCustomer();
    const [other] = await db
      .insert(accountsTable)
      .values({ name: "Other", billingEmail: "o@o.test" })
      .returning();
    await expect(
      acceptVendorUpdate({
        accountId: other!.id,
        deliveryId: s.deliveryId,
        userId: s.ownerId,
      })
    ).rejects.toBeInstanceOf(VendorInboxError);
  });
});
