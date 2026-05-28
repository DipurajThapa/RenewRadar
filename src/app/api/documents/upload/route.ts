/**
 * Document upload route handler.
 *
 * Accepts multipart form data. The actual upload logic lives in the
 * application layer; this handler is the transport adapter: parse the
 * multipart blob, call the use case, format the response, kick off the
 * extraction event.
 *
 * We use a route handler instead of a server action because file upload
 * over a server action has a 5MB body limit and we want headroom to 20MB.
 * Route handlers stream the body without that cap.
 */
import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  DocumentUploadError,
  uploadDocument,
} from "@server/application/documents/upload";
import { inngest } from "@server/jobs/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
    }
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 }
    );
  }
  const subscriptionId = form.get("subscriptionId");
  const subscriptionIdStr =
    typeof subscriptionId === "string" && subscriptionId.trim() !== ""
      ? subscriptionId
      : null;

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const doc = await uploadDocument({
      accountId: account.id,
      uploadedByUserId: user.id,
      subscriptionId: subscriptionIdStr,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
    });

    // Kick off extraction asynchronously. Inngest swallows the event when
    // the dev server isn't connected — in that case the application layer
    // can be called directly from the documents list page's "Run extraction"
    // button as a fallback. Production wires Inngest cloud and this fires.
    try {
      await inngest.send({
        name: "document/extract",
        data: { accountId: account.id, documentId: doc.id },
      });
    } catch (err) {
      console.error("[documents/upload] inngest.send failed:", err);
    }

    return NextResponse.json({ ok: true, document: { id: doc.id, filename: doc.filename } });
  } catch (err) {
    if (err instanceof DocumentUploadError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 400 }
      );
    }
    console.error("[documents/upload] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
