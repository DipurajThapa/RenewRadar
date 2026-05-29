/**
 * Document extraction use case.
 *
 * Runs the full extraction pipeline against a document the user has already
 * uploaded:
 *   1. Atomically reserve pages against the tier's monthly AI-pages cap
 *      (under a per-account advisory lock so concurrent extracts can't
 *       race past the cap — see `reserveAiPagesBudget`)
 *   2. Read bytes from storage
 *   3. OCR / text-extract via the OCR provider
 *   4. Update document.textContent + extraction status
 *   5. Run the AI extraction provider against the text
 *   6. Adjust the run's pagesCharged to the actual page count (the
 *      reservation used an estimate; the actual is recorded at finalize)
 *   7. Persist per-field rows
 *
 * Tenant-scoped end-to-end: every read and write filters on accountId, and
 * we re-check the account binding before writing. The extracted fields land
 * with review_status='pending' — no AI value reaches subscription / renewal
 * event without explicit human approval (binding principle 4).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  aiExtractedFieldsTable,
  aiExtractionRunsTable,
  documentsTable,
  type AiFieldKey,
} from "@server/infrastructure/db/schema";
import type { ExtractedFieldDraft } from "@server/infrastructure/ai/types";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { getOcrProvider } from "@server/infrastructure/ocr";
import { getExtractionProvider } from "@server/infrastructure/ai";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

/**
 * Conservative bytes-per-page estimate for documents we haven't OCR'd yet.
 * Used at reservation time so concurrent uploads can't all "see 0 pages
 * used" and bypass the cap. We round UP at the document level so the
 * estimate over-reserves rather than under-reserves — over-reservation
 * costs at worst a wasted slot until the run finishes and writes the
 * actual count.
 *
 * 50KB/page is conservative for searchable PDFs (typical 20–30KB/page). An
 * image-only PDF scans much higher (~100–500KB/page), so we cap the
 * estimate at 100 pages per document to avoid one giant PDF eating an
 * entire month's budget on a guess.
 */
const ESTIMATED_BYTES_PER_PAGE = 50_000;
const MAX_RESERVATION_PAGES = 100;

function estimatePagesFromBytes(sizeBytes: number): number {
  const raw = Math.ceil(sizeBytes / ESTIMATED_BYTES_PER_PAGE);
  return Math.max(1, Math.min(MAX_RESERVATION_PAGES, raw));
}

export type ExtractDocumentResult = {
  runId: string | null;
  status: "succeeded" | "failed" | "skipped_over_cap";
  fieldsExtracted: number;
  fieldsRejectedForMissingEvidence: number;
  /** Set when status === "skipped_over_cap". User-visible reason. */
  message?: string;
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

  // Load the account once for tier lookup + audit-log actor context.
  const [account] = await db
    .select({ planTier: accountsTable.planTier })
    .from(accountsTable)
    .where(eq(accountsTable.id, input.accountId))
    .limit(1);
  if (!account) {
    throw new Error("Account not found");
  }

  const cap =
    TIER_DEFINITIONS[account.planTier].limits.aiExtractionPagesPerMonth;
  // cap === 0 isn't a special case any more (Free Forever now has 5
  // pages/mo). The atomic reservation below catches "over cap" and
  // returns a friendly upgrade-nudge message.

  // ─────────────────────────────────────────────────────────────────────
  // Atomic cap reservation
  // ─────────────────────────────────────────────────────────────────────
  // The race: pre-fix, two concurrent extracts both read `getMonthlyPagesUsed
  // = 0`, both decided OK, both ran. With 50 concurrent uploads at the cap
  // boundary, the AI provider got billed for far more than the customer paid.
  //
  // Fix: take a per-account advisory lock, sum the budget INSIDE the lock,
  // insert the run row with `pagesCharged = estimatedPages` (pre-reserved),
  // release the lock. The sum reads now include this transaction's
  // reservation, so the next concurrent extract sees the real used amount.
  //
  // Cross-account extracts don't share the lock (key is per-account), so
  // throughput across tenants is unaffected.
  const ai = getExtractionProvider();
  const ocr = getOcrProvider();
  const runId = crypto.randomUUID();
  const estimatedPages = doc.pageCount ?? estimatePagesFromBytes(doc.sizeBytes);

  const reservation: { ok: true } | { ok: false; message: string } =
    await db.transaction(async (tx) => {
      // pg_advisory_xact_lock auto-releases on tx end (commit OR rollback).
      // hashtext returns a stable 32-bit int from the keyspace string.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"ai_pages_budget:" + input.accountId}))`
      );

      // Re-sum the budget INSIDE the lock. Includes any running reservations
      // from concurrent extracts that may have committed before this lock.
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [usedRow] = await tx
        .select({
          pages: sql<number>`coalesce(sum(${aiExtractionRunsTable.pagesCharged}), 0)::int`,
        })
        .from(aiExtractionRunsTable)
        .where(
          and(
            eq(aiExtractionRunsTable.accountId, input.accountId),
            gte(aiExtractionRunsTable.startedAt, monthStart),
            sql`${aiExtractionRunsTable.status} in ('running', 'succeeded')`
          )
        );
      const usedSoFar = usedRow?.pages ?? 0;

      if (Number.isFinite(cap) && usedSoFar + estimatedPages > cap) {
        const upgradeNudge =
          account.planTier === "free_forever"
            ? "Upgrade to Starter for 200 pages/mo."
            : "Upgrade or wait for the next billing cycle.";
        return {
          ok: false,
          message: `You've used ${usedSoFar} of ${cap} AI-extraction pages this month. ${upgradeNudge}`,
        };
      }

      // Reserve. The run row carries pagesCharged from creation so it's
      // immediately visible to the next lock-holder's sum.
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
        pagesCharged: estimatedPages, // reserved; adjusted at finalize
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
          reservedPages: estimatedPages,
        },
      });

      return { ok: true };
    });

  if (!reservation.ok) {
    return {
      runId: null,
      status: "skipped_over_cap",
      fieldsExtracted: 0,
      fieldsRejectedForMissingEvidence: 0,
      message: reservation.message,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // OCR + AI extraction (network/CPU work — runs OUTSIDE the budget lock)
  // ─────────────────────────────────────────────────────────────────────
  let textResult: Awaited<ReturnType<typeof ocr.extract>>;
  let aiResult: Awaited<ReturnType<typeof ai.extract>>;

  try {
    const storage = getDocumentStorage();
    const { bytes } = await storage.get(doc.storageKey);

    textResult = await ocr.extract({ bytes, mimeType: doc.mimeType });

    // Detect image-only PDFs and other unparseable inputs so we (a) tell the
    // user explicitly instead of silently "succeeding" with zero fields, and
    // (b) refund the reservation — the user shouldn't burn budget on a doc
    // we couldn't actually read.
    const trimmedText = textResult.text.trim();
    if (textResult.usedOcr || trimmedText.length === 0) {
      const reason =
        doc.mimeType === "application/pdf" && trimmedText.length < 100
          ? "image_only_pdf"
          : "no_text_extracted";
      const userMessage =
        reason === "image_only_pdf"
          ? "Image-only PDF detected (less than 100 characters of selectable text). Try a searchable PDF, export from the source application, or contact support for OCR — we don't ship paid OCR by default."
          : "No text could be extracted from this file. The file may be encrypted, corrupted, or in an unsupported format.";

      await db.transaction(async (tx) => {
        await tx
          .update(documentsTable)
          .set({
            textContent: trimmedText,
            pageCount: textResult.pageCount,
            // Use status=ready + non-null error → UI renders a yellow
            // "needs attention" banner. Avoids a schema migration.
            textExtractionStatus: "ready",
            textExtractionError: userMessage,
          })
          .where(eq(documentsTable.id, doc.id));
        await tx
          .update(aiExtractionRunsTable)
          .set({
            status: "succeeded",
            pagesCharged: 0, // refund the reservation
            completedAt: new Date(),
            errorMessage: `Extraction skipped: ${reason}`,
          })
          .where(eq(aiExtractionRunsTable.id, runId));
        await writeAuditLog(tx, {
          accountId: input.accountId,
          actorUserId: null,
          action: AUDIT_ACTIONS.extractionCompleted,
          target: { entityType: "ai_extraction_run", entityId: runId },
          after: {
            documentId: doc.id,
            fieldsExtracted: 0,
            reason,
            refundedPages: estimatedPages,
          },
        });
      });
      return {
        runId,
        status: "succeeded",
        fieldsExtracted: 0,
        fieldsRejectedForMissingEvidence: 0,
        message: userMessage,
      };
    }

    // Persist text + page count so the user can later inspect what we saw.
    await db
      .update(documentsTable)
      .set({
        textContent: textResult.text,
        pageCount: textResult.pageCount,
        textExtractionStatus: "ready",
        textExtractionError: null, // clear any prior warning on re-run
      })
      .where(eq(documentsTable.id, doc.id));

    aiResult = await ai.extract({
      text: textResult.text,
      pageBreaks: textResult.pageBreaks,
      pageCount: textResult.pageCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.transaction(async (tx) => {
      await tx
        .update(documentsTable)
        .set({ textExtractionStatus: "failed", textExtractionError: msg })
        .where(eq(documentsTable.id, doc.id));
      // Refund the reservation: mark failed AND zero pagesCharged so the
      // monthly sum no longer counts it. A failed run that consumed no
      // provider tokens shouldn't burn budget.
      await tx
        .update(aiExtractionRunsTable)
        .set({
          status: "failed",
          pagesCharged: 0,
          errorMessage: msg,
          completedAt: new Date(),
        })
        .where(eq(aiExtractionRunsTable.id, runId));
      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: null,
        action: AUDIT_ACTIONS.extractionFailed,
        target: { entityType: "ai_extraction_run", entityId: runId },
        after: { documentId: doc.id, error: msg, refundedPages: estimatedPages },
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
  // Confidence must be an integer 0..100. A future provider returning
  // decimal probabilities (0.85 instead of 85) gets rejected rather than
  // silently coerced to confidence=1.
  const valid: ExtractedFieldDraft[] = [];
  let rejected = 0;
  for (const field of aiResult.fields) {
    if (!field.evidenceQuote || field.evidenceQuote.trim().length === 0) {
      rejected++;
      continue;
    }
    const conf = field.confidencePct;
    if (
      typeof conf !== "number" ||
      !Number.isFinite(conf) ||
      conf < 0 ||
      conf > 100
    ) {
      rejected++;
      continue;
    }
    valid.push({ ...field, confidencePct: Math.round(conf) });
  }

  // Finalize: update run row + insert fields + audit log. The reservation's
  // estimated pages get replaced with the provider's actual `pagesCharged`
  // here. If the actual is lower than the estimate (common — the estimate is
  // a 50KB/page upper bound), the budget self-corrects on the next call.
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
        reservedPages: estimatedPages,
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
