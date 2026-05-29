/**
 * T4.10 Slice 3 — Vendor ↔ Customer connections.
 *
 * Consent model: the CUSTOMER initiates a connection request to a verified
 * vendor_org; the vendor accepts or declines. Either side can move it to
 * 'blocked' (customer blocks; vendor effectively declines forever until the
 * customer re-opens). One row per (accountId, vendorOrgId) — status moves in
 * place, so a re-request after a decline reuses the row.
 *
 * Privacy: the vendor only ever sees the customer's ACCOUNT NAME, never
 * individual user emails. Matching connects a customer's `vendor` row to a
 * verified `vendor_org` by domain (from the vendor website) or normalized
 * company name.
 *
 * Audit: connection lifecycle is recorded in `vendor_audit_log`. The
 * customer-initiated events carry the requesting user id in the after-blob
 * (actorVendorUserId is null — there's no vendor user for those).
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  vendorConnectionsTable,
  vendorOrgsTable,
  vendorsTable,
  type VendorConnection,
  type VendorOrg,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";
import { createLogger } from "@server/infrastructure/observability/logger";
import { domainFromWebsite, normalizeVendorName } from "./internals";

const log = createLogger({ component: "vendor-connections" });

export class VendorConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorConnectionError";
  }
}

export type MatchResult = {
  vendorOrg: VendorOrg;
  /** How we matched — for transparency in the UI. */
  matchedBy: "domain" | "name";
  /** Existing connection between this account and the org, if any. */
  connection: VendorConnection | null;
};

/**
 * Find a verified (active) vendor_org that matches a customer's vendor row,
 * by domain first then normalized name. Returns null when there's no match.
 * Only ACTIVE orgs are matchable — an unverified vendor can't be connected to.
 */
export async function findMatchingVendorOrg(input: {
  accountId: string;
  customerVendorId: string;
}): Promise<MatchResult | null> {
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.id, input.customerVendorId),
        eq(vendorsTable.accountId, input.accountId)
      )
    )
    .limit(1);
  if (!vendor) return null;

  const activeOrgs = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.status, "active"));

  const domain = domainFromWebsite(vendor.website);
  let matched: { org: VendorOrg; by: "domain" | "name" } | null = null;

  if (domain) {
    const byDomain = activeOrgs.find((o) => o.primaryDomain === domain);
    if (byDomain) matched = { org: byDomain, by: "domain" };
  }
  if (!matched) {
    const normName = normalizeVendorName(vendor.name);
    const byName = activeOrgs.find(
      (o) => normalizeVendorName(o.displayName) === normName
    );
    if (byName) matched = { org: byName, by: "name" };
  }
  if (!matched) return null;

  const [connection] = await db
    .select()
    .from(vendorConnectionsTable)
    .where(
      and(
        eq(vendorConnectionsTable.accountId, input.accountId),
        eq(vendorConnectionsTable.vendorOrgId, matched.org.id)
      )
    )
    .limit(1);

  return {
    vendorOrg: matched.org,
    matchedBy: matched.by,
    connection: connection ?? null,
  };
}

/**
 * Customer requests a connection. Upserts the (account, org) row to
 * 'pending'. If a blocked/declined row exists, it's re-opened to pending.
 */
export async function requestConnection(input: {
  accountId: string;
  vendorOrgId: string;
  customerVendorId: string | null;
  requestedByUserId: string;
}): Promise<VendorConnection> {
  // The target org must be active (verified).
  const [org] = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.id, input.vendorOrgId))
    .limit(1);
  if (!org || org.status !== "active") {
    throw new VendorConnectionError(
      "This vendor isn't available to connect with right now."
    );
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(vendorConnectionsTable)
      .where(
        and(
          eq(vendorConnectionsTable.accountId, input.accountId),
          eq(vendorConnectionsTable.vendorOrgId, input.vendorOrgId)
        )
      )
      .limit(1);

    if (existing && existing.status === "connected") {
      return existing; // already connected — no-op
    }
    if (existing && existing.status === "pending") {
      return existing; // request already outstanding — idempotent
    }

    let connection: VendorConnection;
    if (existing) {
      // re-open a declined/blocked row
      const [updated] = await tx
        .update(vendorConnectionsTable)
        .set({
          status: "pending",
          initiatedBy: "customer",
          requestedByUserId: input.requestedByUserId,
          customerVendorId: input.customerVendorId,
          decidedByVendorUserId: null,
          decidedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(vendorConnectionsTable.id, existing.id))
        .returning();
      connection = updated!;
    } else {
      const [created] = await tx
        .insert(vendorConnectionsTable)
        .values({
          vendorOrgId: input.vendorOrgId,
          accountId: input.accountId,
          customerVendorId: input.customerVendorId,
          status: "pending",
          initiatedBy: "customer",
          requestedByUserId: input.requestedByUserId,
        })
        .returning();
      connection = created!;
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: input.vendorOrgId,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorConnectionRequested,
      target: { entityType: "vendor_connection", entityId: connection.id },
      after: {
        accountId: input.accountId,
        requestedByUserId: input.requestedByUserId,
      },
    });

    log.info("vendor_connection_requested", {
      vendorOrgId: input.vendorOrgId,
      accountId: input.accountId,
      connectionId: connection.id,
    });
    return connection;
  });
}

/** Vendor accepts a pending request. */
export async function acceptConnection(input: {
  connectionId: string;
  vendorOrgId: string;
  vendorUserId: string;
}): Promise<VendorConnection> {
  return decideConnection({ ...input, decision: "connected" });
}

/** Vendor declines a pending request. */
export async function declineConnection(input: {
  connectionId: string;
  vendorOrgId: string;
  vendorUserId: string;
}): Promise<VendorConnection> {
  return decideConnection({ ...input, decision: "declined" });
}

async function decideConnection(input: {
  connectionId: string;
  vendorOrgId: string;
  vendorUserId: string;
  decision: "connected" | "declined";
}): Promise<VendorConnection> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(vendorConnectionsTable)
      .set({
        status: input.decision,
        decidedByVendorUserId: input.vendorUserId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vendorConnectionsTable.id, input.connectionId),
          eq(vendorConnectionsTable.vendorOrgId, input.vendorOrgId),
          eq(vendorConnectionsTable.status, "pending") // race-safe
        )
      )
      .returning();
    if (!updated) {
      throw new VendorConnectionError(
        "This request is no longer pending — refresh and try again."
      );
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: input.vendorOrgId,
      actorVendorUserId: input.vendorUserId,
      action:
        input.decision === "connected"
          ? VENDOR_AUDIT_ACTIONS.vendorConnectionAccepted
          : VENDOR_AUDIT_ACTIONS.vendorConnectionDeclined,
      target: { entityType: "vendor_connection", entityId: updated.id },
      before: { status: "pending" },
      after: { status: input.decision, accountId: updated.accountId },
    });
    return updated;
  });
}

/** Customer blocks a vendor — stops all future deliveries. */
export async function blockVendor(input: {
  accountId: string;
  vendorOrgId: string;
  userId: string;
}): Promise<VendorConnection> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(vendorConnectionsTable)
      .where(
        and(
          eq(vendorConnectionsTable.accountId, input.accountId),
          eq(vendorConnectionsTable.vendorOrgId, input.vendorOrgId)
        )
      )
      .limit(1);

    let connection: VendorConnection;
    if (existing) {
      const [updated] = await tx
        .update(vendorConnectionsTable)
        .set({
          status: "blocked",
          requestedByUserId: input.userId,
          updatedAt: new Date(),
        })
        .where(eq(vendorConnectionsTable.id, existing.id))
        .returning();
      connection = updated!;
    } else {
      const [created] = await tx
        .insert(vendorConnectionsTable)
        .values({
          vendorOrgId: input.vendorOrgId,
          accountId: input.accountId,
          status: "blocked",
          initiatedBy: "customer",
          requestedByUserId: input.userId,
        })
        .returning();
      connection = created!;
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: input.vendorOrgId,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorConnectionBlocked,
      target: { entityType: "vendor_connection", entityId: connection.id },
      after: { accountId: input.accountId, blockedByUserId: input.userId },
    });
    return connection;
  });
}

// ─── Reads ────────────────────────────────────────────────────────────────

export type VendorConnectionWithAccount = VendorConnection & {
  accountName: string;
};

/** Pending requests awaiting a vendor's decision (with customer account name). */
export async function listConnectionRequestsForVendor(
  vendorOrgId: string
): Promise<VendorConnectionWithAccount[]> {
  const rows = await db
    .select({
      connection: vendorConnectionsTable,
      accountName: accountsTable.name,
    })
    .from(vendorConnectionsTable)
    .innerJoin(
      accountsTable,
      eq(vendorConnectionsTable.accountId, accountsTable.id)
    )
    .where(
      and(
        eq(vendorConnectionsTable.vendorOrgId, vendorOrgId),
        eq(vendorConnectionsTable.status, "pending")
      )
    )
    .orderBy(desc(vendorConnectionsTable.createdAt));
  return rows.map((r) => ({ ...r.connection, accountName: r.accountName }));
}

/** Connected customers for a vendor. */
export async function listConnectedCustomers(
  vendorOrgId: string
): Promise<VendorConnectionWithAccount[]> {
  const rows = await db
    .select({
      connection: vendorConnectionsTable,
      accountName: accountsTable.name,
    })
    .from(vendorConnectionsTable)
    .innerJoin(
      accountsTable,
      eq(vendorConnectionsTable.accountId, accountsTable.id)
    )
    .where(
      and(
        eq(vendorConnectionsTable.vendorOrgId, vendorOrgId),
        eq(vendorConnectionsTable.status, "connected")
      )
    )
    .orderBy(desc(vendorConnectionsTable.decidedAt));
  return rows.map((r) => ({ ...r.connection, accountName: r.accountName }));
}

/** Count of connected customers — used as a publish gate / stat. */
export async function countConnectedCustomers(
  vendorOrgId: string
): Promise<number> {
  const rows = await db
    .select({ id: vendorConnectionsTable.id })
    .from(vendorConnectionsTable)
    .where(
      and(
        eq(vendorConnectionsTable.vendorOrgId, vendorOrgId),
        eq(vendorConnectionsTable.status, "connected")
      )
    );
  return rows.length;
}

export async function getConnection(
  connectionId: string
): Promise<VendorConnection | null> {
  const [row] = await db
    .select()
    .from(vendorConnectionsTable)
    .where(eq(vendorConnectionsTable.id, connectionId))
    .limit(1);
  return row ?? null;
}
