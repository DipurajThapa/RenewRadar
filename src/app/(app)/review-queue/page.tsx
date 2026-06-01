import { ShieldCheck } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  listAutoAppliedFields,
  listPendingReviewFields,
} from "@server/infrastructure/db/repositories/ai-extractions";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { PageHeader } from "@ui/components/shared/page-header";
import { EmptyState } from "@ui/components/shared/empty-state";
import { ReviewFieldList } from "@ui/features/review-queue/review-field-list";
import { UnlinkedDocumentsBanner } from "@ui/features/review-queue/unlinked-documents-banner";
import {
  AutoAppliedList,
  type AutoAppliedItem,
} from "@ui/features/review-queue/auto-applied-list";

export const dynamic = "force-dynamic";

/** Render an auto-applied field's value for the undo list. */
function autoAppliedLabel(fieldKey: string, valueJson: unknown): string {
  const v = (valueJson ?? {}) as Record<string, unknown>;
  if (fieldKey === "notice_period_days" && typeof v.days === "number") {
    return `${v.days} days`;
  }
  if (
    (fieldKey === "renewal_date" || fieldKey === "expiry_date") &&
    typeof v.date === "string"
  ) {
    return v.date;
  }
  if (fieldKey === "auto_renewal" && typeof v.yes === "boolean") {
    return v.yes ? "on" : "off";
  }
  return "";
}

export default async function ReviewQueuePage() {
  const { account } = await getCurrentAccountAndUser();
  const [fields, subscriptions, autoApplied] = await Promise.all([
    listPendingReviewFields(account.id),
    listSubscriptions(account.id),
    listAutoAppliedFields(account.id),
  ]);

  const autoAppliedItems: AutoAppliedItem[] = autoApplied.map((f) => ({
    fieldId: f.id,
    fieldKey: f.fieldKey,
    label: autoAppliedLabel(f.fieldKey, f.parsedValueJson),
    vendorProduct:
      f.vendorName && f.productName ? `${f.vendorName} — ${f.productName}` : null,
    confidencePct: f.confidence,
  }));

  // Partition into linked (vendorName + productName present) vs unlinked.
  // Unlinked = the document was uploaded without a subscription pick, so
  // its fields can't be applied yet. We surface them as their own banner
  // at the top of the review queue with a "link to subscription" picker.
  const linked = fields.filter((f) => f.subscriptionId !== null);
  const unlinkedByDoc = new Map<
    string,
    { documentId: string; filename: string; fieldCount: number }
  >();
  for (const f of fields) {
    if (f.subscriptionId === null) {
      const existing = unlinkedByDoc.get(f.documentId);
      if (existing) {
        existing.fieldCount += 1;
      } else {
        unlinkedByDoc.set(f.documentId, {
          documentId: f.documentId,
          filename: f.documentFilename,
          fieldCount: 1,
        });
      }
    }
  }
  const unlinkedDocuments = Array.from(unlinkedByDoc.values());
  const subscriptionOptions = subscriptions.map((s) => ({
    id: s.id,
    label: `${s.vendorName} — ${s.productName}`,
  }));

  const isEmpty =
    linked.length === 0 &&
    unlinkedDocuments.length === 0 &&
    autoAppliedItems.length === 0;

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader>
        <PageHeader.Title>Review queue</PageHeader.Title>
        <PageHeader.Description>
          AI-extracted fields awaiting your approval. Every field shows the
          verbatim quote from the contract.{" "}
          <strong className="text-foreground">
            Nothing updates a subscription until you accept.
          </strong>
        </PageHeader.Description>
      </PageHeader>

      {isEmpty ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Nothing to review"
          description="When you upload a contract, extracted fields land here for your approval before they touch a subscription."
          variant="success"
        />
      ) : (
        <>
          <UnlinkedDocumentsBanner
            documents={unlinkedDocuments}
            subscriptions={subscriptionOptions}
          />
          <AutoAppliedList items={autoAppliedItems} />
          {linked.length > 0 && <ReviewFieldList fields={linked} />}
        </>
      )}
    </div>
  );
}
