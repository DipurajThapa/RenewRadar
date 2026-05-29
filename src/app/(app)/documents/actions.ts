"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
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

const documentIdSchema = z.string().uuid();

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

  const parsed = documentIdSchema.safeParse(documentId);
  if (!parsed.success) return { ok: false, error: "Invalid document id" };

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
    // In development we run inline so the user sees an immediate result
    // (Inngest dev server may not be wired). In production we ONLY emit
    // the event — running both would double-charge the AI provider per
    // retrigger click. The Inngest worker picks up the event and runs
    // extractDocument once.
    if (process.env.NODE_ENV === "production") {
      await inngest.send({
        name: "document/extract",
        data: { accountId: account.id, documentId },
      });
    } else {
      await extractDocument({ accountId: account.id, documentId });
    }
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

  const parsed = documentIdSchema.safeParse(documentId);
  if (!parsed.success) return { ok: false, error: "Invalid document id" };

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

// ─────────────────────────────────────────────────────────────────────────
// T3.7 — Bulk re-extraction trigger.
//
// Admin action: re-run extraction across every (or a subset of) the
// account's documents. Used when the AI provider improves (new Claude
// version, prompt revision) and the user wants the upgraded extraction
// applied to their historical contracts.
//
// Scope (intentionally small for v1):
//   - Owner/admin only — re-extraction can burn through a month's AI
//     budget in seconds; gate it behind elevated role.
//   - Fires one Inngest event per qualifying document and returns the
//     dispatched count. The per-document extract function already enforces
//     the page-cap atomically, so an over-cap re-run lands "N succeeded,
//     M skipped over cap" instead of breaching budget.
//   - Skips documents currently mid-extraction (status='pending') so a
//     double-click on the button doesn't fan out two concurrent jobs per
//     document.
// ─────────────────────────────────────────────────────────────────────────

export type BulkReExtractResult =
  | {
      ok: true;
      /** Documents enqueued for re-extraction. */
      dispatched: number;
      /** Documents skipped because they were already mid-extraction. */
      skippedInFlight: number;
    }
  | { ok: false; error: string };

export async function bulkReExtractAction(): Promise<BulkReExtractResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    // Owner/admin only — see scope note above.
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const docs = await db
    .select({
      id: documentsTable.id,
      status: documentsTable.textExtractionStatus,
    })
    .from(documentsTable)
    .where(eq(documentsTable.accountId, account.id));

  let dispatched = 0;
  let skippedInFlight = 0;

  for (const doc of docs) {
    if (doc.status === "pending") {
      skippedInFlight++;
      continue;
    }
    try {
      await inngest.send({
        name: "document/extract",
        data: { accountId: account.id, documentId: doc.id },
      });
      dispatched++;
    } catch {
      // Inngest may be unconfigured in dev — record as skipped so the
      // count is accurate, but don't 500 the whole request.
      skippedInFlight++;
    }
  }

  if (dispatched > 0) {
    await writeAuditLog(db, {
      accountId: account.id,
      actorUserId: user.id,
      action: AUDIT_ACTIONS.extractionStarted,
      target: { entityType: "account", entityId: account.id },
      after: { reason: "bulk_re_extraction", dispatched, skippedInFlight },
    });
  }

  revalidatePath("/documents");
  revalidatePath("/review-queue");
  return { ok: true, dispatched, skippedInFlight };
}
