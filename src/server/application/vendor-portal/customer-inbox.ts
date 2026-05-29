/**
 * T4.10 Slice 5 — Customer-side vendor inbox.
 *
 * The customer reads vendor announcements delivered to their account and
 * triages each on their own terms — advisor, never agent:
 *
 *   - markRead: passive, when the inbox is opened.
 *   - accept: the customer chose to act on it. We stamp the delivery and add
 *     a NOTE to the matching vendor's timeline (`user_note_added`) so the
 *     decision context is preserved. We never auto-change a subscription —
 *     accepting just records that the customer acknowledged the update.
 *   - dismiss: not relevant; clears it from the active inbox.
 *
 * Blocking the vendor is handled by `connections.blockVendor`.
 *
 * Audit: customer triage writes to `vendor_audit_log` (so the vendor's
 * delivery stats are accurate) AND, on accept, to the customer's own vendor
 * timeline via `recordVendorEvent`.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  vendorAnnouncementDeliveriesTable,
  vendorAnnouncementsTable,
  vendorConnectionsTable,
  vendorOrgsTable,
  vendorsTable,
  type VendorAnnouncementDelivery,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "vendor-customer-inbox" });

export class VendorInboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorInboxError";
  }
}

const KIND_LABEL: Record<string, string> = {
  price_change: "Price change",
  renewal_reminder: "Renewal reminder",
  eol: "End-of-life notice",
  general: "Update",
};

export type VendorUpdateRow = {
  deliveryId: string;
  status: VendorAnnouncementDelivery["status"];
  reportedAt: Date | null;
  deliveredAt: Date;
  readAt: Date | null;
  actionedAt: Date | null;
  vendorOrgId: string;
  vendorName: string;
  vendorVerified: boolean;
  announcementId: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  effectiveDate: string | null;
};

/** All vendor updates for an account, newest first. */
export async function listVendorUpdates(
  accountId: string
): Promise<VendorUpdateRow[]> {
  const rows = await db
    .select({
      delivery: vendorAnnouncementDeliveriesTable,
      announcement: vendorAnnouncementsTable,
      org: vendorOrgsTable,
    })
    .from(vendorAnnouncementDeliveriesTable)
    .innerJoin(
      vendorAnnouncementsTable,
      eq(vendorAnnouncementDeliveriesTable.announcementId, vendorAnnouncementsTable.id)
    )
    .innerJoin(
      vendorOrgsTable,
      eq(vendorAnnouncementDeliveriesTable.vendorOrgId, vendorOrgsTable.id)
    )
    .where(eq(vendorAnnouncementDeliveriesTable.accountId, accountId))
    .orderBy(desc(vendorAnnouncementDeliveriesTable.createdAt));

  return rows.map((r) => ({
    deliveryId: r.delivery.id,
    status: r.delivery.status,
    reportedAt: r.delivery.reportedAt,
    deliveredAt: r.delivery.createdAt,
    readAt: r.delivery.readAt,
    actionedAt: r.delivery.actionedAt,
    vendorOrgId: r.org.id,
    vendorName: r.org.displayName,
    vendorVerified: r.org.domainVerifiedAt !== null,
    announcementId: r.announcement.id,
    kind: r.announcement.kind,
    kindLabel: KIND_LABEL[r.announcement.kind] ?? r.announcement.kind,
    title: r.announcement.title,
    body: r.announcement.body,
    effectiveDate: r.announcement.effectiveDate,
  }));
}

/** Count of unread (status = delivered) updates — drives the nav badge. */
export async function getUnreadVendorUpdateCount(
  accountId: string
): Promise<number> {
  const rows = await db
    .select({ id: vendorAnnouncementDeliveriesTable.id })
    .from(vendorAnnouncementDeliveriesTable)
    .where(
      and(
        eq(vendorAnnouncementDeliveriesTable.accountId, accountId),
        eq(vendorAnnouncementDeliveriesTable.status, "delivered")
      )
    );
  return rows.length;
}

async function loadDelivery(accountId: string, deliveryId: string) {
  const [delivery] = await db
    .select()
    .from(vendorAnnouncementDeliveriesTable)
    .where(
      and(
        eq(vendorAnnouncementDeliveriesTable.id, deliveryId),
        eq(vendorAnnouncementDeliveriesTable.accountId, accountId)
      )
    )
    .limit(1);
  if (!delivery) {
    throw new VendorInboxError("Vendor update not found in this account.");
  }
  return delivery;
}

/** Mark a delivered update as read (passive). No-op if already read/actioned. */
export async function markVendorUpdateRead(input: {
  accountId: string;
  deliveryId: string;
}): Promise<void> {
  await db
    .update(vendorAnnouncementDeliveriesTable)
    .set({ status: "read", readAt: new Date() })
    .where(
      and(
        eq(vendorAnnouncementDeliveriesTable.id, input.deliveryId),
        eq(vendorAnnouncementDeliveriesTable.accountId, input.accountId),
        eq(vendorAnnouncementDeliveriesTable.status, "delivered")
      )
    );
}

/**
 * Accept an update. Stamps the delivery, records a note on the matching
 * vendor's timeline (if we can resolve the customer's vendor row), and
 * audit-logs the acceptance for the vendor's stats. Idempotent.
 */
export async function acceptVendorUpdate(input: {
  accountId: string;
  deliveryId: string;
  userId: string;
}): Promise<VendorAnnouncementDelivery> {
  const delivery = await loadDelivery(input.accountId, input.deliveryId);
  if (delivery.status === "accepted") return delivery; // idempotent

  // Pull the announcement + connection (for the customer vendor row).
  const [announcement] = await db
    .select()
    .from(vendorAnnouncementsTable)
    .where(eq(vendorAnnouncementsTable.id, delivery.announcementId))
    .limit(1);
  const [org] = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.id, delivery.vendorOrgId))
    .limit(1);

  // Resolve a still-existing customer vendor row for the timeline note.
  let customerVendorId: string | null = null;
  if (delivery.connectionId) {
    const [conn] = await db
      .select({ customerVendorId: vendorConnectionsTable.customerVendorId })
      .from(vendorConnectionsTable)
      .where(eq(vendorConnectionsTable.id, delivery.connectionId))
      .limit(1);
    if (conn?.customerVendorId) {
      const [vendor] = await db
        .select({ id: vendorsTable.id })
        .from(vendorsTable)
        .where(
          and(
            eq(vendorsTable.id, conn.customerVendorId),
            eq(vendorsTable.accountId, input.accountId)
          )
        )
        .limit(1);
      customerVendorId = vendor?.id ?? null;
    }
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(vendorAnnouncementDeliveriesTable)
      .set({
        status: "accepted",
        actionedAt: new Date(),
        actionedByUserId: input.userId,
        readAt: delivery.readAt ?? new Date(),
      })
      .where(eq(vendorAnnouncementDeliveriesTable.id, delivery.id))
      .returning();
    if (!updated) throw new VendorInboxError("Failed to update the delivery.");

    // Customer-side timeline note (only if we have a vendor row).
    if (customerVendorId && announcement && org) {
      const label = KIND_LABEL[announcement.kind] ?? announcement.kind;
      await recordVendorEvent(tx, {
        accountId: input.accountId,
        vendorId: customerVendorId,
        kind: "user_note_added",
        actorUserId: input.userId,
        relatedEntityType: "vendor_announcement",
        relatedEntityId: announcement.id,
        payload: {
          note: `Accepted ${label} from ${org.displayName}: "${announcement.title}"`,
        },
      });
    }

    // Vendor-side audit so delivery stats stay accurate.
    await writeVendorAuditLog(tx, {
      vendorOrgId: delivery.vendorOrgId,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorAnnouncementAccepted,
      target: {
        entityType: "vendor_announcement_delivery",
        entityId: delivery.id,
      },
      after: { accountId: input.accountId, acceptedByUserId: input.userId },
    });

    log.info("vendor_update_accepted", {
      accountId: input.accountId,
      deliveryId: delivery.id,
    });
    return updated;
  });
}

/**
 * T4.10 Slice 6 — report an update as spam / inappropriate. Flags the
 * delivery (reportedAt + reason) for staff review; the vendor's complaint
 * count is computed from these. Also dismisses it from the active inbox.
 */
export async function reportVendorUpdate(input: {
  accountId: string;
  deliveryId: string;
  userId: string;
  reason: string;
}): Promise<VendorAnnouncementDelivery> {
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) {
    throw new VendorInboxError("A short reason is required to report an update.");
  }
  const delivery = await loadDelivery(input.accountId, input.deliveryId);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(vendorAnnouncementDeliveriesTable)
      .set({
        // Reporting also clears it from the active inbox.
        status: delivery.status === "accepted" ? "accepted" : "dismissed",
        reportedAt: new Date(),
        reportReason: reason,
        actionedAt: delivery.actionedAt ?? new Date(),
        actionedByUserId: delivery.actionedByUserId ?? input.userId,
        readAt: delivery.readAt ?? new Date(),
      })
      .where(eq(vendorAnnouncementDeliveriesTable.id, delivery.id))
      .returning();
    if (!updated) throw new VendorInboxError("Failed to report the update.");

    await writeVendorAuditLog(tx, {
      vendorOrgId: delivery.vendorOrgId,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorAnnouncementReported,
      target: {
        entityType: "vendor_announcement_delivery",
        entityId: delivery.id,
      },
      after: { accountId: input.accountId, reason },
    });
    log.info("vendor_update_reported", {
      accountId: input.accountId,
      deliveryId: delivery.id,
    });
    return updated;
  });
}

/** Dismiss an update — clears it from the active inbox. Idempotent. */
export async function dismissVendorUpdate(input: {
  accountId: string;
  deliveryId: string;
  userId: string;
}): Promise<VendorAnnouncementDelivery> {
  const delivery = await loadDelivery(input.accountId, input.deliveryId);
  if (delivery.status === "dismissed") return delivery;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(vendorAnnouncementDeliveriesTable)
      .set({
        status: "dismissed",
        actionedAt: new Date(),
        actionedByUserId: input.userId,
        readAt: delivery.readAt ?? new Date(),
      })
      .where(eq(vendorAnnouncementDeliveriesTable.id, delivery.id))
      .returning();
    if (!updated) throw new VendorInboxError("Failed to update the delivery.");

    await writeVendorAuditLog(tx, {
      vendorOrgId: delivery.vendorOrgId,
      actorVendorUserId: null,
      action: VENDOR_AUDIT_ACTIONS.vendorAnnouncementDismissed,
      target: {
        entityType: "vendor_announcement_delivery",
        entityId: delivery.id,
      },
      after: { accountId: input.accountId, dismissedByUserId: input.userId },
    });
    return updated;
  });
}
