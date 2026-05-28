/**
 * Document upload use case.
 *
 * Single business operation: take bytes + metadata from the caller, store
 * them, persist the document row, and queue the extraction job. Wrapped in
 * a transaction so a failure anywhere leaves no orphaned row or storage
 * object (the storage write happens before the row insert, so on failure
 * we just clean up the bytes — the row was never visible).
 */
import { eq } from "drizzle-orm";
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

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export type UploadDocumentInput = {
  accountId: string;
  uploadedByUserId: string;
  subscriptionId?: string | null;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  kind?: DocumentKind;
};

export type UploadDocumentResult = Document;

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
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new DocumentUploadError(
      `Unsupported MIME type: ${input.mimeType}. Allowed: PDF, DOCX, plain text.`
    );
  }

  // If a subscriptionId is provided, verify it belongs to this account
  // BEFORE we write any storage bytes. Defense-in-depth — the caller's
  // server action also validates, but a cross-account write would leak.
  if (input.subscriptionId) {
    const [sub] = await db
      .select({ accountId: subscriptionsTable.accountId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, input.subscriptionId))
      .limit(1);
    if (!sub || sub.accountId !== input.accountId) {
      throw new DocumentUploadError("Subscription not found in this account");
    }
  }

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

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
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
      if (!row) throw new Error("Insert returned no row");

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.uploadedByUserId,
        action: AUDIT_ACTIONS.documentUploaded,
        target: { entityType: "document", entityId: row.id },
        after: {
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          subscriptionId: row.subscriptionId,
        },
      });

      return row;
    });
  } catch (err) {
    // Clean up the storage object; we never reached the consistent state.
    await storage.delete(putResult.storageKey).catch(() => undefined);
    throw err;
  }
}
