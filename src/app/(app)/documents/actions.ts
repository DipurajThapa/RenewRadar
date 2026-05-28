"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { db } from "@server/infrastructure/db/client";
import { documentsTable } from "@server/infrastructure/db/schema";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { inngest } from "@server/jobs/client";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { extractDocument } from "@server/application/documents/extract";

export type DocumentActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Manually re-run extraction for a document. Useful when:
 *   - The Inngest dev server wasn't connected when the document was uploaded
 *   - The first extraction failed and the user wants to retry
 *   - The provider changed (e.g., heuristic-stub → real Anthropic)
 *
 * Runs synchronously in the action so the user sees the result immediately.
 * For long-running extractions in production the action just emits the
 * event and Inngest handles it; for development we run inline so the dev
 * loop is tight.
 */
export async function retriggerExtractionAction(
  documentId: string
): Promise<DocumentActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  // Defense-in-depth: verify the document belongs to this account before
  // running anything.
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.accountId, account.id)
      )
    )
    .limit(1);
  if (!doc) return { ok: false, error: "Document not found" };

  try {
    // Always fire the event so production Inngest can pick it up...
    await inngest
      .send({
        name: "document/extract",
        data: { accountId: account.id, documentId },
      })
      .catch(() => undefined);
    // ...and run inline so the user gets immediate feedback in dev.
    await extractDocument({ accountId: account.id, documentId });
  } catch (err) {
    console.error("[retriggerExtraction] failed:", err);
    return { ok: false, error: "Extraction failed; check logs" };
  }

  revalidatePath("/documents");
  revalidatePath("/review-queue");
  return { ok: true };
}

export async function deleteDocumentAction(
  documentId: string
): Promise<DocumentActionResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const storage = getDocumentStorage();

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, documentId),
            eq(documentsTable.accountId, account.id)
          )
        )
        .limit(1);
      if (!existing) throw new Error("Document not found");

      // FK cascades will remove ai_extraction_run + ai_extracted_field rows;
      // we just clean up the bytes after the row is gone.
      await tx.delete(documentsTable).where(eq(documentsTable.id, existing.id));
      await writeAuditLog(tx, {
        accountId: account.id,
        actorUserId: user.id,
        action: AUDIT_ACTIONS.documentDeleted,
        target: { entityType: "document", entityId: existing.id },
        before: {
          filename: existing.filename,
          subscriptionId: existing.subscriptionId,
        },
      });
      // Best-effort bytes cleanup outside the SQL transaction.
      void storage.delete(existing.storageKey).catch(() => undefined);
    });
  } catch (err) {
    console.error("[deleteDocument] failed:", err);
    return { ok: false, error: "Couldn't delete the document" };
  }

  revalidatePath("/documents");
  revalidatePath("/review-queue");
  return { ok: true };
}
