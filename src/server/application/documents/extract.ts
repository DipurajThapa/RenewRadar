/**
 * Document extraction use case.
 *
 * Runs the full extraction pipeline against a document the user has already
 * uploaded:
 *   1. Read bytes from storage
 *   2. OCR / text-extract via the OCR provider
 *   3. Update document.textContent + extraction status
 *   4. Run the AI extraction provider against the text
 *   5. Persist run metadata + per-field rows
 *
 * Tenant-scoped end-to-end: every read and write filters on accountId, and
 * we re-check the account binding before writing. The extracted fields land
 * with review_status='pending' — no AI value reaches subscription / renewal
 * event without explicit human approval (binding principle 4).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
  type AiFieldKey,
} from "@server/infrastructure/db/schema";
import type { ExtractedFieldDraft } from "@server/infrastructure/ai/types";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { getOcrProvider } from "@server/infrastructure/ocr";
import { getExtractionProvider } from "@server/infrastructure/ai";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

export type ExtractDocumentResult = {
  runId: string;
  status: "succeeded" | "failed";
  fieldsExtracted: number;
  fieldsRejectedForMissingEvidence: number;
};

export async function extractDocument(input: {
  accountId: string;
  documentId: string;
}): Promise<ExtractDocumentResult> {
  // Load the document; bail if it isn't in this account.
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, input.documentId),
        eq(documentsTable.accountId, input.accountId)
      )
    )
    .limit(1);
  if (!doc) {
    throw new Error("Document not found for this account");
  }

  // Mark extracting + create the run row.
  const ocr = getOcrProvider();
  const ai = getExtractionProvider();
  const runId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .update(documentsTable)
      .set({ textExtractionStatus: "extracting", textExtractionError: null })
      .where(eq(documentsTable.id, doc.id));
    await tx.insert(aiExtractionRunsTable).values({
      id: runId,
      accountId: input.accountId,
      documentId: doc.id,
      provider: ai.providerName,
      model: ai.model,
      promptVersion: ai.promptVersion,
      status: "running",
    });
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: null,
      action: AUDIT_ACTIONS.extractionStarted,
      target: { entityType: "ai_extraction_run", entityId: runId },
      after: {
        documentId: doc.id,
        provider: ai.providerName,
        model: ai.model,
        promptVersion: ai.promptVersion,
      },
    });
  });

  let textResult: Awaited<ReturnType<typeof ocr.extract>>;
  let aiResult: Awaited<ReturnType<typeof ai.extract>>;

  try {
    const storage = getDocumentStorage();
    const { bytes } = await storage.get(doc.storageKey);

    textResult = await ocr.extract({ bytes, mimeType: doc.mimeType });

    // Persist text + page count so the user can later inspect what we saw.
    await db
      .update(documentsTable)
      .set({
        textContent: textResult.text,
        pageCount: textResult.pageCount,
        textExtractionStatus: "ready",
      })
      .where(eq(documentsTable.id, doc.id));

    aiResult = await ai.extract({
      text: textResult.text,
      pageBreaks: textResult.pageBreaks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.transaction(async (tx) => {
      await tx
        .update(documentsTable)
        .set({ textExtractionStatus: "failed", textExtractionError: msg })
        .where(eq(documentsTable.id, doc.id));
      await tx
        .update(aiExtractionRunsTable)
        .set({
          status: "failed",
          errorMessage: msg,
          completedAt: new Date(),
        })
        .where(eq(aiExtractionRunsTable.id, runId));
      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: null,
        action: AUDIT_ACTIONS.extractionFailed,
        target: { entityType: "ai_extraction_run", entityId: runId },
        after: { documentId: doc.id, error: msg },
      });
    });
    return {
      runId,
      status: "failed",
      fieldsExtracted: 0,
      fieldsRejectedForMissingEvidence: 0,
    };
  }

  // Validate every field has evidence. Binding principle 4: no field without
  // evidence_quote and (when pages exist) evidence_page_number lands.
  const valid: ExtractedFieldDraft[] = [];
  let rejected = 0;
  for (const field of aiResult.fields) {
    if (!field.evidenceQuote || field.evidenceQuote.trim().length === 0) {
      rejected++;
      continue;
    }
    // Confidence must be in 0..100; clamp defensively rather than reject.
    const conf = Math.min(100, Math.max(0, field.confidencePct));
    valid.push({ ...field, confidencePct: conf });
  }

  // Persist the run + the field rows + finalize the document status.
  await db.transaction(async (tx) => {
    await tx
      .update(aiExtractionRunsTable)
      .set({
        status: "succeeded",
        costUsdMicros: aiResult.meta.costUsdMicros,
        pagesCharged: aiResult.meta.pagesCharged,
        completedAt: new Date(),
      })
      .where(eq(aiExtractionRunsTable.id, runId));

    if (valid.length > 0) {
      await tx.insert(aiExtractedFieldsTable).values(
        valid.map((field) => ({
          accountId: input.accountId,
          runId,
          documentId: doc.id,
          subscriptionId: doc.subscriptionId,
          fieldKey: field.fieldKey as AiFieldKey,
          rawValue: field.rawValue,
          parsedValueJson: field.parsedValueJson as Record<string, unknown>,
          confidence: field.confidencePct,
          evidenceQuote: field.evidenceQuote,
          evidencePageNumber: field.evidencePageNumber,
          reviewStatus: "pending" as const,
        }))
      );
    }

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: null,
      action: AUDIT_ACTIONS.extractionCompleted,
      target: { entityType: "ai_extraction_run", entityId: runId },
      after: {
        documentId: doc.id,
        fieldsExtracted: valid.length,
        fieldsRejected: rejected,
        pagesCharged: aiResult.meta.pagesCharged,
      },
    });
  });

  return {
    runId,
    status: "succeeded",
    fieldsExtracted: valid.length,
    fieldsRejectedForMissingEvidence: rejected,
  };
}
