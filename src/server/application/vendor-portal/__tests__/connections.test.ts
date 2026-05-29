/**
 * T4.10 Slice 3 — vendor↔customer connection contract tests.
 *
 * Invariants:
 *   - Matching finds an ACTIVE vendor_org by domain (from website) or name;
 *     never matches a pending/unverified org.
 *   - Customer request → pending; vendor accept → connected; decline → declined.
 *   - Re-request after decline/block re-opens the same row (one row per pair).
 *   - Block sets status blocked.
 *   - Accept/decline are race-safe (only act on pending).
 *   - Tenant scope: account B can't see/act on account A's connections.
 *   - Privacy: listConnectionRequestsForVendor returns account NAME only.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  usersTable,
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
  blockVendor,
  countConnectedCustomers,
  declineConnection,
  findMatchingVendorOrg,
  listConnectedCustomers,
  listConnectionRequestsForVendor,
  requestConnection,
  VendorConnectionError,
} from "@server/application/vendor-portal/connections";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

/** Provision a verified (active) vendor org + admin vendor user. */
async function verifiedVendor(email: string) {
  const r = await requestMagicLink({ email });
  await manuallyVerifyDomain({ vendorOrgId: r.vendorOrg.id, note: "test" });
  const [org] = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.id, r.vendorOrg.id));
  return { org: org!, vendorUserId: r.vendorUser.id };
}

/** Create a customer account with a vendor row. */
async function customerWithVendor(opts: {
  name: string;
  vendorName: string;
  website?: string | null;
}) {
  const [account] = await db
    .insert(accountsTable)
    .values({ name: opts.name, billingEmail: `${opts.name}@c.test` })
    .returning();
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      accountId: account!.id,
      name: opts.vendorName,
      website: opts.website ?? null,
    })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({
      accountId: account!.id,
      clerkUserId: `clerk_${account!.id}`,
      workEmail: `owner@${opts.name.replace(/\s/g, "")}.test`,
      fullName: "Owner",
      role: "owner",
    })
    .returning();
  return { accountId: account!.id, vendorId: vendor!.id, userId: user!.id };
}

describe("findMatchingVendorOrg", () => {
  it("matches an active org by website domain", async () => {
    const { org } = await verifiedVendor("ceo@acmesoft.io"); // domain acmesoft.io
    const cust = await customerWithVendor({
      name: "Customer A",
      vendorName: "Acme Software",
      website: "https://www.acmesoft.io/pricing",
    });
    const match = await findMatchingVendorOrg({
      accountId: cust.accountId,
      customerVendorId: cust.vendorId,
    });
    expect(match?.vendorOrg.id).toBe(org.id);
    expect(match?.matchedBy).toBe("domain");
  });

  it("matches by normalized name when domain doesn't match", async () => {
    // org displayName derives from domain "acmewidgets.io" → "Acmewidgets"
    const { org } = await verifiedVendor("founder@acmewidgets.io");
    const cust = await customerWithVendor({
      name: "Customer B",
      vendorName: "  acmewidgets ", // normalizes to "acmewidgets"
      website: null,
    });
    const match = await findMatchingVendorOrg({
      accountId: cust.accountId,
      customerVendorId: cust.vendorId,
    });
    expect(match?.vendorOrg.id).toBe(org.id);
    expect(match?.matchedBy).toBe("name");
  });

  it("does NOT match an unverified (pending) org", async () => {
    // pending org — not verified
    await requestMagicLink({ email: "x@pendingco.io" });
    const cust = await customerWithVendor({
      name: "Customer C",
      vendorName: "Pendingco",
      website: "https://pendingco.io",
    });
    const match = await findMatchingVendorOrg({
      accountId: cust.accountId,
      customerVendorId: cust.vendorId,
    });
    expect(match).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    await verifiedVendor("a@realvendor.io");
    const cust = await customerWithVendor({
      name: "Customer D",
      vendorName: "Totally Different",
      website: "https://different.com",
    });
    const match = await findMatchingVendorOrg({
      accountId: cust.accountId,
      customerVendorId: cust.vendorId,
    });
    expect(match).toBeNull();
  });
});

describe("connection lifecycle", () => {
  it("request → pending → accept → connected", async () => {
    const { org, vendorUserId } = await verifiedVendor("a@flow.io");
    const cust = await customerWithVendor({
      name: "Flow Customer",
      vendorName: "Flow",
      website: "https://flow.io",
    });

    const conn = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: cust.userId,
    });
    expect(conn.status).toBe("pending");

    // Vendor sees the request with account name only
    const requests = await listConnectionRequestsForVendor(org.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.accountName).toBe("Flow Customer");

    const accepted = await acceptConnection({
      connectionId: conn.id,
      vendorOrgId: org.id,
      vendorUserId,
    });
    expect(accepted.status).toBe("connected");
    expect(await countConnectedCustomers(org.id)).toBe(1);
    expect(await listConnectedCustomers(org.id)).toHaveLength(1);
  });

  it("request is idempotent (no duplicate rows)", async () => {
    const { org } = await verifiedVendor("a@idem.io");
    const cust = await customerWithVendor({
      name: "Idem",
      vendorName: "Idem",
      website: "https://idem.io",
    });
    const userId = cust.userId;
    const a = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: userId,
    });
    const b = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: userId,
    });
    expect(b.id).toBe(a.id);
    const rows = await db
      .select()
      .from(vendorConnectionsTable)
      .where(eq(vendorConnectionsTable.vendorOrgId, org.id));
    expect(rows).toHaveLength(1);
  });

  it("decline then re-request re-opens the same row", async () => {
    const { org, vendorUserId } = await verifiedVendor("a@reopen.io");
    const cust = await customerWithVendor({
      name: "Reopen",
      vendorName: "Reopen",
      website: "https://reopen.io",
    });
    const userId = cust.userId;
    const conn = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: userId,
    });
    await declineConnection({ connectionId: conn.id, vendorOrgId: org.id, vendorUserId });
    const reopened = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: userId,
    });
    expect(reopened.id).toBe(conn.id);
    expect(reopened.status).toBe("pending");
  });

  it("accept refuses a non-pending connection (race-safe)", async () => {
    const { org, vendorUserId } = await verifiedVendor("a@race.io");
    const cust = await customerWithVendor({
      name: "Race",
      vendorName: "Race",
      website: "https://race.io",
    });
    const conn = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: cust.userId,
    });
    await acceptConnection({ connectionId: conn.id, vendorOrgId: org.id, vendorUserId });
    // second accept should fail (no longer pending)
    await expect(
      acceptConnection({ connectionId: conn.id, vendorOrgId: org.id, vendorUserId })
    ).rejects.toBeInstanceOf(VendorConnectionError);
  });

  it("block sets status blocked", async () => {
    const { org } = await verifiedVendor("a@block.io");
    const cust = await customerWithVendor({
      name: "Block",
      vendorName: "Block",
      website: "https://block.io",
    });
    const blocked = await blockVendor({
      accountId: cust.accountId,
      vendorOrgId: org.id,
      userId: cust.userId,
    });
    expect(blocked.status).toBe("blocked");
  });

  it("a vendor cannot accept another vendor's connection (tenant scope)", async () => {
    const a = await verifiedVendor("a@vendora.io");
    const b = await verifiedVendor("b@vendorb.io");
    const cust = await customerWithVendor({
      name: "Cust",
      vendorName: "VendorA",
      website: "https://vendora.io",
    });
    const conn = await requestConnection({
      accountId: cust.accountId,
      vendorOrgId: a.org.id,
      customerVendorId: cust.vendorId,
      requestedByUserId: cust.userId,
    });
    // Vendor B tries to accept A's connection → fails (vendorOrgId guard)
    await expect(
      acceptConnection({
        connectionId: conn.id,
        vendorOrgId: b.org.id,
        vendorUserId: b.vendorUserId,
      })
    ).rejects.toBeInstanceOf(VendorConnectionError);
  });

  it("refuses connecting to an unverified org", async () => {
    const r = await requestMagicLink({ email: "x@unverified.io" }); // pending
    const cust = await customerWithVendor({
      name: "X",
      vendorName: "Unverified",
      website: "https://unverified.io",
    });
    await expect(
      requestConnection({
        accountId: cust.accountId,
        vendorOrgId: r.vendorOrg.id,
        customerVendorId: cust.vendorId,
        requestedByUserId: cust.userId,
      })
    ).rejects.toBeInstanceOf(VendorConnectionError);
  });
});
