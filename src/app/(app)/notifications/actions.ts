"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/infrastructure/db/client";
import { notificationsTable } from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";

const markReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export type MarkReadResult = { ok: true } | { ok: false; error: string };

/**
 * Mark one in-app notification as delivered.
 *
 * The where clause includes accountId + userId so a crafted notification ID
 * from another tenant cannot be marked — even if the caller knows the UUID,
 * the filter rejects it. No audit log is written for read-receipts: these
 * are personal state, not a change to a business-critical row.
 */
export async function markNotificationReadAction(
  notificationId: string
): Promise<MarkReadResult> {
  const { account, user } = await getCurrentAccountAndUser();
  const parsed = markReadSchema.safeParse({ notificationId });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  await db
    .update(notificationsTable)
    .set({ status: "delivered" })
    .where(
      and(
        eq(notificationsTable.id, parsed.data.notificationId),
        eq(notificationsTable.accountId, account.id),
        eq(notificationsTable.userId, user.id),
        eq(notificationsTable.channel, "in_app"),
        eq(notificationsTable.status, "queued")
      )
    );

  revalidatePath("/", "layout"); // bell badge lives in the app layout
  return { ok: true };
}

/**
 * Bulk: mark every queued in-app notification for the current user as delivered.
 */
export async function markAllNotificationsReadAction(): Promise<MarkReadResult> {
  const { account, user } = await getCurrentAccountAndUser();

  await db
    .update(notificationsTable)
    .set({ status: "delivered" })
    .where(
      and(
        eq(notificationsTable.accountId, account.id),
        eq(notificationsTable.userId, user.id),
        eq(notificationsTable.channel, "in_app"),
        eq(notificationsTable.status, "queued")
      )
    );

  revalidatePath("/", "layout");
  return { ok: true };
}
