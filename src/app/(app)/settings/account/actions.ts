"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { updateAccountSchema } from "@shared/validation/account";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { z } from "zod";

export type UpdateAccountResult =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string[]> };

export async function updateAccountAction(
  _prev: UpdateAccountResult | undefined,
  formData: FormData
): Promise<UpdateAccountResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const parsed = updateAccountSchema.safeParse({
    name: formData.get("name"),
    billingEmail: formData.get("billingEmail"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(accountsTable)
        .set(parsed.data)
        .where(eq(accountsTable.id, account.id));

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.accountUpdated,
        target: { entityType: "account", entityId: account.id },
        before: {
          name: account.name,
          billingEmail: account.billingEmail,
          timezone: account.timezone,
        },
        after: parsed.data as unknown as Record<string, unknown>,
      });
    });
  } catch (err) {
    console.error("[updateAccountAction] failed:", err);
    return { ok: false, formError: "Couldn't save. Please try again." };
  }

  revalidatePath("/settings/account");
  revalidatePath("/dashboard");
  return { ok: true };
}

const approvalsToggleSchema = z.boolean();

/**
 * Flip the account-wide approvals-lite toggle. Admin/owner only.
 *
 * Note: the value is also reflected on the decide-now action's gating logic
 * via account.requireApprovals — this is the single write path.
 */
export async function toggleApprovalsRequiredAction(
  enabled: boolean
): Promise<UpdateAccountResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, formError: err.message };
    }
    throw err;
  }

  const parsed = approvalsToggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false, formError: "Invalid input" };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(accountsTable)
        .set({ requireApprovals: parsed.data })
        .where(eq(accountsTable.id, account.id));

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.approvalsToggled,
        target: { entityType: "account", entityId: account.id },
        before: { requireApprovals: account.requireApprovals },
        after: { requireApprovals: parsed.data },
      });
    });
  } catch (err) {
    console.error("[toggleApprovalsRequiredAction] failed:", err);
    return { ok: false, formError: "Couldn't save. Please try again." };
  }

  revalidatePath("/settings/account");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true };
}
