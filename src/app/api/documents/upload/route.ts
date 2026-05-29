/**
 * Document upload route handler.
 *
 * Accepts multipart form data with one or more files under the field name
 * `file` (legacy single-file) or `files` (bulk). Each file is processed
 * independently — a per-file failure (size, MIME, dedup, cap) does NOT block
 * the others. The response is shaped as a list of per-file results so the UI
 * can render a clear "5 uploaded, 2 skipped" list.
 *
 * We use a route handler instead of a server action because file upload over
 * a server action has a 5MB body limit and we want headroom to 20MB per file.
 * Route handlers stream the body without that cap. The aggregate request body
 * is bounded by Next.js's default ~4.5MB per-request body limit in some
 * deploy targets — for genuinely large batches (50+ contracts), the client
 * is responsible for chunking the upload across multiple POSTs. The per-file
 * cap (20MB) and per-request count cap (10 files) below are the contract.
 */
import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  DocumentUploadError,
  uploadDocument,
} from "@server/application/documents/upload";
import { inngest } from "@server/jobs/client";
import { createLogger } from "@server/infrastructure/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ component: "api.documents.upload" });

/**
 * Per-request cap on number of files. Higher numbers risk hitting the
 * platform's request-body size limit and producing partial uploads. The
 * client splits a 50-PDF folder into 5 batches of 10.
 */
const MAX_FILES_PER_REQUEST = 10;

export type UploadResultEntry =
  | {
      ok: true;
      filename: string;
      documentId: string;
      /**
       * True when the upload matched an existing document by checksum and
       * the prior row was returned. The UI surfaces this so the user
       * understands they're looking at a previously-uploaded contract,
       * not a freshly-extracted one.
       */
      alreadyExisted: boolean;
      /** ISO timestamp of the document's original upload (createdAt). */
      originalUploadedAt: string;
    }
  | { ok: false; filename: string; error: string };

export type UploadResponse =
  | {
      ok: true;
      results: UploadResultEntry[];
      uploaded: number;
      skipped: number;
    }
  | { ok: false; error: string };

export async function POST(req: Request) {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: err.message } satisfies UploadResponse,
        { status: 403 }
      );
    }
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Expected multipart/form-data",
      } satisfies UploadResponse,
      { status: 400 }
    );
  }

  // Accept both `file` (legacy, single) and `files` (bulk). `getAll` returns
  // both so we de-dupe on identity and filter to File instances.
  const candidates = [...form.getAll("file"), ...form.getAll("files")];
  const files = candidates.filter((c): c is File => c instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing 'file' or 'files' field",
      } satisfies UploadResponse,
      { status: 400 }
    );
  }

  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many files in one request (max ${MAX_FILES_PER_REQUEST}). Split into batches.`,
      } satisfies UploadResponse,
      { status: 400 }
    );
  }

  const subscriptionId = form.get("subscriptionId");
  const subscriptionIdStr =
    typeof subscriptionId === "string" && subscriptionId.trim() !== ""
      ? subscriptionId
      : null;

  const results: UploadResultEntry[] = [];

  // Process files sequentially. The upload use case takes a per-account
  // advisory lock when reserving AI budget; sequential processing is the
  // simplest correct path and the time cost is dominated by the storage
  // write, not by latency overhead.
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await uploadDocument({
        accountId: account.id,
        accountPlanTier: account.planTier,
        uploadedByUserId: user.id,
        subscriptionId: subscriptionIdStr,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes,
      });

      // Skip the extraction event for documents we've already seen — the
      // first upload already triggered (or failed) extraction; re-firing
      // would waste budget on identical content.
      if (!result.alreadyExisted) {
        try {
          await inngest.send({
            name: "document/extract",
            data: {
              accountId: account.id,
              documentId: result.document.id,
            },
          });
        } catch (err) {
          log.warn("inngest_send_failed", {
            documentId: result.document.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      results.push({
        ok: true,
        filename: file.name,
        documentId: result.document.id,
        alreadyExisted: result.alreadyExisted,
        originalUploadedAt: result.document.uploadedAt.toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof DocumentUploadError
          ? err.message
          : "Server error during upload";
      if (!(err instanceof DocumentUploadError)) {
        // Unexpected — log it loud, but still record the per-file failure
        // so the user sees their batch result.
        log.error("upload_unexpected_error", err, { filename: file.name });
      }
      results.push({
        ok: false,
        filename: file.name,
        error: message,
      });
    }
  }

  const uploaded = results.filter((r) => r.ok).length;
  const skipped = results.length - uploaded;

  return NextResponse.json({
    ok: true,
    results,
    uploaded,
    skipped,
  } satisfies UploadResponse);
}
