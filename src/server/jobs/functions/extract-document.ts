/**
 * Extract-document Inngest function.
 *
 * Triggered by `event: "document/extract"` whenever a document is uploaded.
 * Runs the extraction pipeline in the application layer; per-tenant
 * concurrency cap of 3 protects against a single noisy account starving
 * the worker.
 *
 * On failure the application layer flips the document status to "failed"
 * with an error message — the user sees a clear "Extraction failed: …"
 * row in the documents list and can retry.
 */
import { inngest } from "@server/jobs/client";
import { extractDocument } from "@server/application/documents/extract";

export const extractDocumentJob = inngest.createFunction(
  {
    id: "extract-document",
    name: "Extract fields from a document",
    retries: 2,
    concurrency: { limit: 3, key: "event.data.accountId" },
  },
  { event: "document/extract" },
  async ({ event, step }) => {
    const { accountId, documentId } = event.data as {
      accountId: string;
      documentId: string;
    };
    if (!accountId || !documentId) {
      return { skipped: true, reason: "missing accountId or documentId" };
    }
    const result = await step.run("run-extraction", () =>
      extractDocument({ accountId, documentId })
    );
    return result;
  }
);
