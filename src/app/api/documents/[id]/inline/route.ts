/**
 * Inline PDF viewer route — serves a document with `Content-Disposition:
 * inline` so the browser opens it in-tab instead of downloading.
 *
 * Used by the "verify quote" affordance on the review queue: when the AI
 * extracted "30-day notice period" and quoted page 5, the reviewer
 * clicks the page-anchor link and lands directly on page 5 in their
 * browser's PDF viewer (most viewers honour the `#page=N` URL fragment).
 *
 * Audit P2 friction item: pre-fix the reviewer had no fast way to
 * verify the quote was real. Now it's a single click.
 *
 * Tenant scope: only the caller's account can read its own documents.
 * Cross-account requests return 404 (not 403) so the existence of the
 * document ID isn't leaked.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { db } from "@server/infrastructure/db/client";
import { documentsTable } from "@server/infrastructure/db/schema";
import { getDocumentStorage } from "@server/infrastructure/storage";
import { createLogger } from "@server/infrastructure/observability/logger";
import { isUuid } from "@shared/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger({ component: "api.documents.inline" });

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  if (!isUuid(params.id)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { account } = await getCurrentAccountAndUser();

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, params.id),
        eq(documentsTable.accountId, account.id)
      )
    )
    .limit(1);

  if (!doc) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Only PDFs are meaningfully "inline-viewable" in browsers. For other
  // types, we redirect to a sensible fallback (eventually a download).
  if (doc.mimeType !== "application/pdf") {
    return new NextResponse(
      `Inline preview is only available for PDFs (this file is ${doc.mimeType}).`,
      { status: 415 }
    );
  }

  try {
    const storage = getDocumentStorage();
    const { bytes } = await storage.get(doc.storageKey);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // INLINE — not attachment. The browser opens in-tab.
        // The user-controlled stored filename is sanitized + RFC 5987-encoded.
        // Bare interpolation let a filename with a `"` or CR/LF break the
        // header and a non-ASCII filename mojibake; this strips CR/LF and
        // quotes, ASCII-fallbacks for the legacy `filename=`, and emits the
        // full encoded name in `filename*` per RFC 6266.
        "Content-Disposition": buildInlineDisposition(doc.filename),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    log.error("inline_document_read_failed", err, {
      accountId: account.id,
      documentId: doc.id,
    });
    return new NextResponse("Failed to read document", { status: 500 });
  }
}

/**
 * Safe Content-Disposition for a user-controlled filename. Strips control
 * chars (CR/LF would let an attacker inject another header), removes the
 * double-quote that would break the legacy `filename="…"` token, ASCII-folds
 * the legacy token, and emits `filename*` per RFC 5987 with the full UTF-8
 * name so modern browsers still get it right.
 */
function buildInlineDisposition(rawFilename: string): string {
  const stripped = rawFilename.replace(/[\r\n\x00-\x1f"\\]/g, "_") || "document";
  // Legacy ASCII fallback — drop non-ASCII so an old browser can't choke.
  const ascii = stripped.replace(/[^\x20-\x7e]/g, "_") || "document";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(stripped)}`;
}
