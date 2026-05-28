"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  applyExtractedField,
  reviewExtractedField,
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
