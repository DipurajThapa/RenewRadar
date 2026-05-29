/**
 * T4.10 Slice 4 — Vendor announcements + fan-out delivery.
 *
 * A verified, active vendor drafts an announcement, then publishes it. On
 * publish it fans out to every CONNECTED customer as a delivery row and each
 * customer's approvers (owners + admins) are notified (in-app + email) via the
 * shared `dispatchNotification` helper.
 *
 * Anti-spam: a vendor may publish at most `MAX_ANNOUNCEMENTS_PER_DAY` in any
 * rolling 24h window. This is enforced from the DB (durable across restarts),
 * not the in-memory rate limiter.
 *
 * Advisor, never agent: Renewal Radar delivers these into the customer's own
 * inbox. The customer triages on their own terms (Slice 5). We never act on
 * the announcement automatically and never email the customer's vendors.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  usersTable,
  vendorAnnouncementDeliveriesTable,
  vendorAnnouncementsTable,
  vendorConnectionsTable,
  vendorOrgsTable,
  type VendorAnnouncement,
  type VendorAnnouncementKind,
} from "@server/infrastructure/db/schema";
import {
  VENDOR_AUDIT_ACTIONS,
  writeVendorAuditLog,
} from "@server/infrastructure/vendor-audit-log/writer";
import { dispatchNotification } from "@server/application/notifications/dispatch";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "vendor-announcements" });

export const MAX_ANNOUNCEMENTS_PER_DAY = 5;
const MAX_TITLE = 140;
const MAX_BODY = 4000;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

export class VendorAnnouncementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorAnnouncementError";
  }
}

const KIND_LABEL: Record<VendorAnnouncementKind, string> = {
  price_change: "Price change",
  renewal_reminder: "Renewal reminder",
  eol: "End-of-life notice",
  general: "Update",
};

export type CreateAnnouncementInput = {
  vendorOrgId: string;
  vendorUserId: string;
  kind: VendorAnnouncementKind;
  title: string;
  body: string;
  effectiveDate?: string | null; // YYYY-MM-DD
};

export async function createAnnouncement(
  input: CreateAnnouncementInput
): Promise<VendorAnnouncement> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > MAX_TITLE) {
    throw new VendorAnnouncementError(`Title is required (≤ ${MAX_TITLE} chars).`);
  }
  if (!body || body.length > MAX_BODY) {
    throw new VendorAnnouncementError(`Body is required (≤ ${MAX_BODY} chars).`);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vendorAnnouncementsTable)
      .values({
        vendorOrgId: input.vendorOrgId,
        kind: input.kind,
        title,
        body,
        effectiveDate: input.effectiveDate ?? null,
        status: "draft",
        createdByVendorUserId: input.vendorUserId,
      })
      .returning();
    if (!row) throw new VendorAnnouncementError("Failed to create announcement.");

    await writeVendorAuditLog(tx, {
      vendorOrgId: input.vendorOrgId,
      actorVendorUserId: input.vendorUserId,
      action: VENDOR_AUDIT_ACTIONS.vendorAnnouncementCreated,
      target: { entityType: "vendor_announcement", entityId: row.id },
      after: { kind: row.kind, title: row.title },
    });
    return row;
  });
}

export type PublishResult = {
  announcement: VendorAnnouncement;
  deliveredCount: number;
};

/**
 * Publish a draft. Validates the org is active, enforces the daily cap, fans
 * out delivery rows to connected customers, then notifies them. Notifications
 * fire AFTER the publish transaction commits (so a slow email never holds the
 * publish open) but are awaited so they complete before we return.
 */
export async function publishAnnouncement(input: {
  announcementId: string;
  vendorOrgId: string;
  vendorUserId: string;
}): Promise<PublishResult> {
  const [org] = await db
    .select()
    .from(vendorOrgsTable)
    .where(eq(vendorOrgsTable.id, input.vendorOrgId))
    .limit(1);
  if (!org) throw new VendorAnnouncementError("Vendor org not found.");
  if (org.status !== "active" || !org.domainVerifiedAt) {
    throw new VendorAnnouncementError(
      "Verify your domain before publishing announcements to customers."
    );
  }

  const [announcement] = await db
    .select()
    .from(vendorAnnouncementsTable)
    .where(
      and(
        eq(vendorAnnouncementsTable.id, input.announcementId),
        eq(vendorAnnouncementsTable.vendorOrgId, input.vendorOrgId)
      )
    )
    .limit(1);
  if (!announcement) throw new VendorAnnouncementError("Announcement not found.");
  if (announcement.status === "published") {
    throw new VendorAnnouncementError("This announcement is already published.");
  }

  // Daily cap (rolling 24h).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const published = await db
    .select({ id: vendorAnnouncementsTable.id })
    .from(vendorAnnouncementsTable)
    .where(
      and(
        eq(vendorAnnouncementsTable.vendorOrgId, input.vendorOrgId),
        eq(vendorAnnouncementsTable.status, "published"),
        gte(vendorAnnouncementsTable.publishedAt, dayAgo)
      )
    );
  if (published.length >= MAX_ANNOUNCEMENTS_PER_DAY) {
    throw new VendorAnnouncementError(
      `You can publish at most ${MAX_ANNOUNCEMENTS_PER_DAY} announcements per day. Try again later.`
    );
  }

  // Connected customers (accounts) to deliver to.
  const connections = await db
    .select({
      connectionId: vendorConnectionsTable.id,
      accountId: vendorConnectionsTable.accountId,
    })
    .from(vendorConnectionsTable)
    .where(
      and(
        eq(vendorConnectionsTable.vendorOrgId, input.vendorOrgId),
        eq(vendorConnectionsTable.status, "connected")
      )
    );

  // Publish + create delivery rows + audit in one transaction.
  const updated = await db.transaction(async (tx) => {
    const [pub] = await tx
      .update(vendorAnnouncementsTable)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(vendorAnnouncementsTable.id, input.announcementId),
          eq(vendorAnnouncementsTable.vendorOrgId, input.vendorOrgId),
          eq(vendorAnnouncementsTable.status, "draft") // race-safe
        )
      )
      .returning();
    if (!pub) {
      throw new VendorAnnouncementError(
        "Announcement changed while publishing — refresh and try again."
      );
    }

    for (const conn of connections) {
      await tx
        .insert(vendorAnnouncementDeliveriesTable)
        .values({
          announcementId: pub.id,
          vendorOrgId: input.vendorOrgId,
          accountId: conn.accountId,
          connectionId: conn.connectionId,
          status: "delivered",
        })
        .onConflictDoNothing();
    }

    await writeVendorAuditLog(tx, {
      vendorOrgId: input.vendorOrgId,
      actorVendorUserId: input.vendorUserId,
      action: VENDOR_AUDIT_ACTIONS.vendorAnnouncementPublished,
      target: { entityType: "vendor_announcement", entityId: pub.id },
      after: { kind: pub.kind, title: pub.title, deliveredTo: connections.length },
    });
    return pub;
  });

  // Notify each connected customer's approvers — after commit.
  await notifyConnectedCustomers({
    announcement: updated,
    vendorName: org.displayName,
    accountIds: connections.map((c) => c.accountId),
  });

  log.info("vendor_announcement_published", {
    vendorOrgId: input.vendorOrgId,
    announcementId: updated.id,
    deliveredCount: connections.length,
  });

  return { announcement: updated, deliveredCount: connections.length };
}

async function notifyConnectedCustomers(input: {
  announcement: VendorAnnouncement;
  vendorName: string;
  accountIds: string[];
}): Promise<void> {
  if (input.accountIds.length === 0) return;

  const recipients = await db
    .select({
      id: usersTable.id,
      accountId: usersTable.accountId,
      workEmail: usersTable.workEmail,
      fullName: usersTable.fullName,
      notificationPrefs: usersTable.notificationPrefs,
    })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.accountId, input.accountIds),
        inArray(usersTable.role, ["owner", "admin"])
      )
    );

  const url = `${APP_URL}/vendor-updates`;
  const kindLabel = KIND_LABEL[input.announcement.kind];
  const subject = `${input.vendorName}: ${input.announcement.title}`;

  await Promise.all(
    recipients.map((r) =>
      dispatchNotification({
        accountId: r.accountId,
        recipient: r,
        trigger: "vendor_announcement",
        entityType: "vendor_announcement",
        entityId: input.announcement.id,
        inAppPayload: {
          vendorName: input.vendorName,
          kind: input.announcement.kind,
          title: input.announcement.title,
        },
        email: {
          subject,
          html: renderHtml({
            vendorName: input.vendorName,
            kindLabel,
            title: input.announcement.title,
            body: input.announcement.body,
            effectiveDate: input.announcement.effectiveDate,
            url,
          }),
          text: renderText({
            vendorName: input.vendorName,
            kindLabel,
            title: input.announcement.title,
            url,
          }),
        },
      }).catch((err) => {
        log.warn("vendor_announcement_notify_failed", {
          recipientId: r.id,
          err: err instanceof Error ? err.message : String(err),
        });
      })
    )
  );
}

// ─── Reads ──────────────────────────────────────────────────────────────

export type AnnouncementWithStats = VendorAnnouncement & {
  deliveredCount: number;
  readCount: number;
  acceptedCount: number;
  dismissedCount: number;
  reportedCount: number;
};

/**
 * List a vendor's announcements with per-announcement delivery stats
 * (T4.10 Slice 6 surfaces these). Stats computed from delivery rows.
 */
export async function listAnnouncementsWithStats(
  vendorOrgId: string
): Promise<AnnouncementWithStats[]> {
  const announcements = await db
    .select()
    .from(vendorAnnouncementsTable)
    .where(eq(vendorAnnouncementsTable.vendorOrgId, vendorOrgId))
    .orderBy(desc(vendorAnnouncementsTable.createdAt));

  if (announcements.length === 0) return [];

  const statRows = await db
    .select({
      announcementId: vendorAnnouncementDeliveriesTable.announcementId,
      total: sql<number>`count(*)::int`,
      read: sql<number>`count(*) filter (where ${vendorAnnouncementDeliveriesTable.status} in ('read','accepted','dismissed'))::int`,
      accepted: sql<number>`count(*) filter (where ${vendorAnnouncementDeliveriesTable.status} = 'accepted')::int`,
      dismissed: sql<number>`count(*) filter (where ${vendorAnnouncementDeliveriesTable.status} = 'dismissed')::int`,
      reported: sql<number>`count(*) filter (where ${vendorAnnouncementDeliveriesTable.reportedAt} is not null)::int`,
    })
    .from(vendorAnnouncementDeliveriesTable)
    .where(eq(vendorAnnouncementDeliveriesTable.vendorOrgId, vendorOrgId))
    .groupBy(vendorAnnouncementDeliveriesTable.announcementId);

  const byId = new Map(statRows.map((s) => [s.announcementId, s]));
  return announcements.map((a) => {
    const s = byId.get(a.id);
    return {
      ...a,
      deliveredCount: s?.total ?? 0,
      readCount: s?.read ?? 0,
      acceptedCount: s?.accepted ?? 0,
      dismissedCount: s?.dismissed ?? 0,
      reportedCount: s?.reported ?? 0,
    };
  });
}

export async function getAnnouncement(
  announcementId: string,
  vendorOrgId: string
): Promise<VendorAnnouncement | null> {
  const [row] = await db
    .select()
    .from(vendorAnnouncementsTable)
    .where(
      and(
        eq(vendorAnnouncementsTable.id, announcementId),
        eq(vendorAnnouncementsTable.vendorOrgId, vendorOrgId)
      )
    )
    .limit(1);
  return row ?? null;
}

// ─── Email templates ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(p: {
  vendorName: string;
  kindLabel: string;
  title: string;
  body: string;
  effectiveDate: string | null;
  url: string;
}): string {
  const eff = p.effectiveDate
    ? `<p style="margin:0 0 12px; font-size:13px; color:#475569;"><strong>Effective:</strong> ${escapeHtml(p.effectiveDate)}</p>`
    : "";
  return `<!doctype html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p style="margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#0f766e;">${escapeHtml(p.kindLabel)} · ${escapeHtml(p.vendorName)}</p>
  <h1 style="font-size:18px; margin:0 0 12px;">${escapeHtml(p.title)}</h1>
  ${eff}
  <div style="font-size:14px; white-space:pre-wrap; color:#334155;">${escapeHtml(p.body)}</div>
  <p style="margin:20px 0;"><a href="${p.url}" style="display:inline-block; background:#4f46e5; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">Review in Renewal Radar</a></p>
  <p style="margin:24px 0 0; font-size:12px; color:#64748b;">
    You're getting this because your team connected with ${escapeHtml(p.vendorName)} on Renewal Radar. You decide what to do with it — accept, dismiss, or block the vendor. Renewal Radar is your advisor; we never act on your behalf.
  </p>
</body></html>`;
}

function renderText(p: {
  vendorName: string;
  kindLabel: string;
  title: string;
  url: string;
}): string {
  return [
    `${p.kindLabel} from ${p.vendorName}`,
    "",
    p.title,
    "",
    `Review it: ${p.url}`,
    "",
    `You're getting this because your team connected with ${p.vendorName} on Renewal Radar. You decide what to do with it.`,
  ].join("\n");
}
