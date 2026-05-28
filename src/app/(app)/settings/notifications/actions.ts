"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/write";

// Triggers whose alerts cannot be muted — these are the wedge protections.
const LOCKED_TRIGGERS = new Set([
  "notice_window_7",
  "notice_window_3",
  "notice_window_1",
]);

const channelPrefSchema = z.object({
  email: z.boolean(),
  in_app: z.boolean(),
});

const prefsSchema = z.record(z.string(), channelPrefSchema);

export type SavePrefsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveNotificationPrefsAction(
  prefs: Record<string, { email: boolean; in_app: boolean }>
): Promise<SavePrefsResult> {
  const { account, user } = await getCurrentAccountAndUser();

  const parsed = prefsSchema.safeParse(prefs);
  if (!parsed.success) {
    return { ok: false, error: "Invalid preferences" };
  }

  // Force locked triggers ON regardless of submitted value
  const sanitized: Record<string, { email: boolean; in_app: boolean }> = {
    ...parsed.data,
  };
  for (const trigger of LOCKED_TRIGGERS) {
    sanitized[trigger] = { email: true, in_app: true };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ notificationPrefs: sanitized })
        .where(eq(usersTable.id, user.id));

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.notificationPrefsUpdated,
        target: { entityType: "user", entityId: user.id },
        before: (user.notificationPrefs as Record<string, unknown>) ?? {},
        after: sanitized as unknown as Record<string, unknown>,
      });
    });
  } catch (err) {
    console.error("[saveNotificationPrefsAction] failed:", err);
    return { ok: false, error: "Couldn't save preferences. Please try again." };
  }

  revalidatePath("/settings/notifications");
  return { ok: true };
}
