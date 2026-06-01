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
import { autoApplyHighConfidenceFields } from "@server/application/documents/apply-field";

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

    // Conservative confidence-gated auto-apply — OFF unless explicitly enabled
    // at deploy time. Only safe, high-confidence fields are written (and each is
    // one-click reversible). Off by default keeps the advisor-not-agent posture:
    // turning it on is a deliberate operational choice.
    if (
      result.status === "succeeded" &&
      process.env.AI_AUTO_APPLY_ENABLED === "true"
    ) {
      const autoApply = await step.run("auto-apply-high-confidence", () =>
        autoApplyHighConfidenceFields({ accountId, documentId })
      );
      return { ...result, autoApply };
    }

    return result;
  }
);
