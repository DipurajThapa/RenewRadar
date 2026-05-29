import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  notificationsTable,
  subscriptionsTable,
  vendorsTable,
} from "@server/infrastructure/db/schema";

export type InAppNotificationRow = {
  id: string;
  trigger: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  createdAt: Date;
  /** Resolved when entityType = "subscription". Null otherwise (e.g. account-level notices). */
  vendorName: string | null;
  productName: string | null;
};

export type NotificationListRow = InAppNotificationRow & {
  channel: string;
  sentAt: Date | null;
};

/**
 * Most recent in-app notifications for a user, newest first.
 *
 * Tenant scope is via the accountId filter — even though notification rows
 * carry a userId that's globally unique, the explicit accountId guard is the
 * pattern every query in this codebase follows (and the tenant-isolation
 * test enforces).
 *
 * Joined to subscription + vendor when entityType = "subscription" so the
 * dropdown row can render "Atlassian — Jira" without a second round-trip.
 */
export async function listRecentInAppNotifications(
  accountId: string,
  userId: string,
  limit = 20
): Promise<InAppNotificationRow[]> {
  return db
    .select({
      id: notificationsTable.id,
      trigger: notificationsTable.trigger,
      entityType: notificationsTable.entityType,
      entityId: notificationsTable.entityId,
      status: notificationsTable.status,
      createdAt: notificationsTable.createdAt,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
    })
    .from(notificationsTable)
    .leftJoin(
      subscriptionsTable,
      and(
        eq(notificationsTable.entityType, "subscription"),
        eq(notificationsTable.entityId, subscriptionsTable.id)
      )
    )
    .leftJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(notificationsTable.accountId, accountId),
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.channel, "in_app")
      )
    )
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
}

/**
 * Full notifications history for the inbox page. Returns ALL channels
 * (email + in-app + slack), filtered to the caller's user. Includes
 * `status` and `sentAt` so the page can surface failed sends to admins.
 *
 * Limit defaults to 100. The inbox is paginated client-side for simplicity.
 */
export async function listNotificationsForUser(
  accountId: string,
  userId: string,
  options: { limit?: number } = {}
): Promise<NotificationListRow[]> {
  return db
    .select({
      id: notificationsTable.id,
      trigger: notificationsTable.trigger,
      entityType: notificationsTable.entityType,
      entityId: notificationsTable.entityId,
      status: notificationsTable.status,
      createdAt: notificationsTable.createdAt,
      channel: notificationsTable.channel,
      sentAt: notificationsTable.sentAt,
      vendorName: vendorsTable.name,
      productName: subscriptionsTable.productName,
    })
    .from(notificationsTable)
    .leftJoin(
      subscriptionsTable,
      and(
        eq(notificationsTable.entityType, "subscription"),
        eq(notificationsTable.entityId, subscriptionsTable.id)
      )
    )
    .leftJoin(vendorsTable, eq(subscriptionsTable.vendorId, vendorsTable.id))
    .where(
      and(
        eq(notificationsTable.accountId, accountId),
        eq(notificationsTable.userId, userId)
      )
    )
    .orderBy(desc(notificationsTable.createdAt))
    .limit(options.limit ?? 100);
}

/**
 * Count of unread (queued) in-app notifications. Cheap COUNT(*) so we can
 * call it on every layout render without a perceptible cost.
 */
export async function countUnreadInAppNotifications(
  accountId: string,
  userId: string
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.accountId, accountId),
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.channel, "in_app"),
        eq(notificationsTable.status, "queued")
      )
    );
  return result[0]?.count ?? 0;
}
