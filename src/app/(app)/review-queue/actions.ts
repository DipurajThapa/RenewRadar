"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  documentsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import {
  applyExtractedField,
  reviewExtractedField,
  revertAutoAppliedField,
} from "@server/application/documents/apply-field";

export type ReviewActionResult =
  | { ok: true }
  | { ok: false; error: string };

const reviewSchema = z.object({
  fieldId: z.string().uuid(),
  decision: z.enum(["accepted", "edited", "rejected"]),
  editedValueJson: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * Accept / edit / reject a pending extracted field. The accept and edit
 * paths apply the value to the linked subscription immediately afterward
 * — the user's intent is "yes, this is the truth, write it through."
 *
 * The reject path stops at marking the field rejected; no downstream write.
 */
export async function reviewFieldAction(
  fieldId: string,
  decision: "accepted" | "edited" | "rejected",
  editedValueJson: Record<string, unknown> | null = null
): Promise<ReviewActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = reviewSchema.safeParse({
    fieldId,
    decision,
    editedValueJson,
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

  const reviewResult = await reviewExtractedField({
    accountId: account.id,
    actorUserId: user.id,
    fieldId: parsed.data.fieldId,
    decision: parsed.data.decision,
    editedValueJson: parsed.data.editedValueJson ?? null,
  });

  if (!reviewResult.ok) {
    return { ok: false, error: reviewResult.error };
  }

  if (parsed.data.decision === "accepted" || parsed.data.decision === "edited") {
    const applyResult = await applyExtractedField({
      accountId: account.id,
      actorUserId: user.id,
      fieldId: parsed.data.fieldId,
    });
    if (!applyResult.ok) {
      // The review stuck; the apply failed. Surface this so the user can
      // try again or notify the team.
      return { ok: false, error: `Reviewed but couldn't apply: ${applyResult.error}` };
    }
  }

  revalidatePath("/review-queue");
  revalidatePath("/documents");
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");
  return { ok: true };
}

const revertSchema = z.object({ fieldId: z.string().uuid() });

/**
 * One-click undo for an AI auto-applied field. Restores the previous value and
 * marks the field as a human-rejected correction (Gate-4 feedback signal).
 */
export async function revertAutoAppliedFieldAction(
  fieldId: string
): Promise<ReviewActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = revertSchema.safeParse({ fieldId });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const result = await revertAutoAppliedField({
    accountId: account.id,
    actorUserId: user.id,
    fieldId: parsed.data.fieldId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/review-queue");
  revalidatePath("/documents");
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/action-queue");
  return { ok: true };
}

const linkInputSchema = z.object({
  documentId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
});

/**
 * Link an uploaded document (and all of its pending extracted fields) to a
 * subscription after-the-fact. Closes the "unlinked document dead-end" —
 * before this, fields uploaded without a subscription pick stayed
 * unappliable forever, no recovery path. Now the user picks a subscription
 * from the review queue and the linkage cascades to every field row.
 *
 * RBAC + tenant scope + zod parsing match the surrounding actions.
 */
export async function linkDocumentToSubscriptionAction(
  documentId: string,
  subscriptionId: string
): Promise<ReviewActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  const parsed = linkInputSchema.safeParse({ documentId, subscriptionId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

  try {
    await db.transaction(async (tx) => {
      // Tenant-scoped: document and subscription must both belong to this
      // account. We verify in the same transaction as the link so a
      // concurrent delete or transfer can't slip past the check.
      const [doc] = await tx
        .select({ id: documentsTable.id })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, parsed.data.documentId),
            eq(documentsTable.accountId, account.id)
          )
        )
        .limit(1);
      if (!doc) throw new Error("Document not found");

      const [sub] = await tx
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.id, parsed.data.subscriptionId),
            eq(subscriptionsTable.accountId, account.id)
          )
        )
        .limit(1);
      if (!sub) throw new Error("Subscription not found");

      // Link the document and cascade to every pending field row so the
      // user can immediately review + accept them.
      await tx
        .update(documentsTable)
        .set({ subscriptionId: parsed.data.subscriptionId })
        .where(eq(documentsTable.id, parsed.data.documentId));

      await tx
        .update(aiExtractedFieldsTable)
        .set({ subscriptionId: parsed.data.subscriptionId })
        .where(
          and(
            eq(aiExtractedFieldsTable.accountId, account.id),
            eq(aiExtractedFieldsTable.documentId, parsed.data.documentId)
          )
        );

      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.documentUploaded,
        target: { entityType: "document", entityId: parsed.data.documentId },
        after: { subscriptionId: parsed.data.subscriptionId, linkedAt: new Date() },
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't link";
    return { ok: false, error: msg };
  }

  revalidatePath("/review-queue");
  revalidatePath("/documents");
  revalidatePath("/subscriptions");
  return { ok: true };
}
