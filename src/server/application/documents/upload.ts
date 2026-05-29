/**
 * Document upload use case.
 *
 * Single business operation: take bytes + metadata from the caller, store
 * them, persist the document row, optionally emit a vendor event when the
 * contract is attached to a subscription, and let the caller queue the
 * extraction job. Wrapped in a transaction so a failure anywhere leaves no
 * orphaned row or storage object (the storage write happens before the row
 * insert, so on failure we just clean up the bytes — the row was never
 * visible).
 *
 * Cap enforcement happens here too so a Free Forever account, which has a
 * 0-page/month AI cap, can't accumulate uploads that will never extract
 * (revenue-leak surface). The cap is also enforced inside `extractDocument`
 * — defense in depth covers retriggers and job replays.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  documentsTable,
  subscriptionsTable,
} from "@server/infrastructure/db/schema";
import type {
  Document,
  DocumentKind,
} from "@server/infrastructure/db/schema";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";
import { recordEvent } from "@server/infrastructure/analytics";
import { recordVendorEvent } from "@server/application/vendor-memory/recorder";
import { getMonthlyPagesUsed } from "@server/infrastructure/db/repositories/ai-extractions";
import { getTotalStorageBytes } from "@server/infrastructure/db/repositories/documents";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";
import type { PlanTier } from "@server/domain/billing/tier-definitions";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
// Keep this in lock-step with `LocalTextExtractor` — what the extractor can
// read is what we accept. Adding a new MIME requires both a parser and a
// review of the heuristic extractor's quote-spans logic.
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "text/html",
]);

export type UploadDocumentInput = {
  accountId: string;
  /** Account's plan tier — required so we can enforce the AI-pages cap. */
  accountPlanTier: PlanTier;
  uploadedByUserId: string;
  subscriptionId?: string | null;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  kind?: DocumentKind;
};

export type UploadDocumentResult = {
  document: Document;
  /**
   * True when this upload matched an existing document by checksum — we
   * returned the prior row instead of inserting a new one. The caller is
   * expected to surface this to the user (the UI shows "Already uploaded on
   * <date>") so a duplicate upload doesn't look like a silent success.
   *
   * Storage bytes for the just-uploaded copy are discarded inside this
   * function before we return — the AI-extraction budget is not charged
   * twice either.
   */
  alreadyExisted: boolean;
};

export class DocumentUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentUploadError";
  }
}

export async function uploadDocument(
  input: UploadDocumentInput
): Promise<UploadDocumentResult> {
  if (input.bytes.byteLength === 0) {
    throw new DocumentUploadError("Document is empty");
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new DocumentUploadError(
      `Document is too large (${input.bytes.byteLength} bytes; max ${MAX_BYTES})`
    );
  }
  if (!ALLOWED_MIME.has(input.mimeType.toLowerCase())) {
    throw new DocumentUploadError(
      `Unsupported MIME type: ${input.mimeType}. ` +
        `Allowed: PDF, DOCX/DOC, XLSX/XLS, CSV, plain text, markdown, HTML.`
    );
  }

  // Storage cap — refuse uploads when the account's total stored bytes
  // already meet/exceed the tier cap. Pre-check before bytes hit storage
  // so a refusal doesn't leave orphaned data. The dedup check below
  // catches re-uploads of identical content (which would have failed
  // here even if room existed — that's OK; dedup short-circuit happens
  // after this gate, so an at-cap account can't even attempt the dedup).
  const storageCap =
    TIER_DEFINITIONS[input.accountPlanTier].limits.maxStorageBytes;
  if (Number.isFinite(storageCap)) {
    const used = await getTotalStorageBytes(input.accountId);
    if (used + input.bytes.byteLength > storageCap) {
      const usedMb = (used / (1024 * 1024)).toFixed(0);
      const capMb = (storageCap / (1024 * 1024)).toFixed(0);
      throw new DocumentUploadError(
        `Storage cap reached (${usedMb} MB used of ${capMb} MB). Delete old contracts or upgrade your plan to make room.`
      );
    }
  }

  // AI extraction cap — surface the limit early so the user isn't surprised
  // by a silently-failing extraction post-upload. Skipped for Enterprise
  // (Infinity). Free Forever has a small budget (5 pages/mo) for one
  // contract — designed to land the activation moment, not to be a viable
  // ongoing usage path.
  const cap =
    TIER_DEFINITIONS[input.accountPlanTier].limits.aiExtractionPagesPerMonth;
  if (Number.isFinite(cap)) {
    const used = await getMonthlyPagesUsed(input.accountId);
    if (used >= cap) {
      const upgradeNudge =
        input.accountPlanTier === "free_forever"
          ? "Upgrade to Starter for 200 pages/mo."
          : "Upgrade or wait for the next billing cycle.";
      throw new DocumentUploadError(
        `You've used ${used} of ${cap} AI-extraction pages this month. ${upgradeNudge}`
      );
    }
  }

  // If a subscriptionId is provided, verify it belongs to this account
  // BEFORE we write any storage bytes. Defense-in-depth — the caller's
  // server action also validates, but a cross-account write would leak.
  let subscriptionVendorId: string | null = null;
  if (input.subscriptionId) {
    const [sub] = await db
      .select({
        accountId: subscriptionsTable.accountId,
        vendorId: subscriptionsTable.vendorId,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, input.subscriptionId))
      .limit(1);
    if (!sub || sub.accountId !== input.accountId) {
      throw new DocumentUploadError("Subscription not found in this account");
    }
    subscriptionVendorId = sub.vendorId;
  }

  // Checksum dedup: if the same file (same bytes) was already uploaded to
  // this account, return that row instead of double-storing. Catches the
  // common "re-uploaded the same DocuSign export by accident" case and
  // protects the AI-pages budget from accidental double-charging.
  // The caller's storage adapter computes the checksum below; we re-query
  // after that to find any existing row.

  // We pre-generate the document ID so the storage key embeds it; the
  // row insert below uses the same ID. If the row insert fails after the
  // storage write succeeded we clean up the bytes.
  const documentId = crypto.randomUUID();
  const storage = getDocumentStorage();
  const putResult = await storage.put({
    accountId: input.accountId,
    documentId,
    filename: input.filename,
    contentType: input.mimeType,
    bytes: input.bytes,
  });

  // Dedup check (post-checksum-compute, pre-row-insert).
  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.accountId, input.accountId),
        eq(documentsTable.checksumSha256, putResult.checksumSha256)
      )
    )
    .limit(1);
  if (existing) {
    // Discard the just-written bytes and return the pre-existing row. The
    // user sees the same document they already had; the AI-pages budget is
    // untouched. The caller distinguishes this case via `alreadyExisted`.
    await storage.delete(putResult.storageKey).catch(() => undefined);
    return { document: existing, alreadyExisted: true };
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(documentsTable)
        .values({
          id: documentId,
          accountId: input.accountId,
          subscriptionId: input.subscriptionId ?? null,
          uploadedByUserId: input.uploadedByUserId,
          kind: input.kind ?? "contract",
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: putResult.sizeBytes,
          storageKey: putResult.storageKey,
          checksumSha256: putResult.checksumSha256,
          textExtractionStatus: "pending",
        })
        .returning();
      if (!inserted) throw new Error("Insert returned no row");

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.uploadedByUserId,
        action: AUDIT_ACTIONS.documentUploaded,
        target: { entityType: "document", entityId: inserted.id },
        after: {
          filename: inserted.filename,
          mimeType: inserted.mimeType,
          sizeBytes: inserted.sizeBytes,
          subscriptionId: inserted.subscriptionId,
        },
      });

      // Vendor memory — record contract uploads against the linked vendor.
      // Skipped when the document isn't attached to a subscription
      // (vendor-less file uploads from /documents land here too).
      if (subscriptionVendorId && input.subscriptionId) {
        await recordVendorEvent(tx, {
          accountId: input.accountId,
          vendorId: subscriptionVendorId,
          subscriptionId: input.subscriptionId,
          kind: "contract_uploaded",
          payload: {
            documentId: inserted.id,
            filename: inserted.filename,
            sizeBytes: inserted.sizeBytes,
            pageCount: null, // OCR populates this; emit null at upload time
          },
          actorUserId: input.uploadedByUserId,
          relatedEntityType: "document",
          relatedEntityId: inserted.id,
        });
      }

      return inserted;
    });

    // Activation funnel: a contract upload is the first highly-correlated
    // signal of activation. We fire AFTER the commit so PostHog never sees
    // a phantom upload that was rolled back.
    void recordEvent({
      event: "document.uploaded",
      context: {
        accountId: input.accountId,
        userId: input.uploadedByUserId,
      },
      properties: {
        documentId: row.id,
        kind: row.kind,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        attachedToSubscription: row.subscriptionId !== null,
      },
    });

    return { document: row, alreadyExisted: false };
  } catch (err) {
    // Clean up the storage object; we never reached the consistent state.
    await storage.delete(putResult.storageKey).catch(() => undefined);
    throw err;
  }
}
