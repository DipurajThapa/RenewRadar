import { ShieldCheck } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listPendingReviewFields } from "@server/infrastructure/db/repositories/ai-extractions";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { PageHeader } from "@ui/components/shared/page-header";
import { EmptyState } from "@ui/components/shared/empty-state";
import { ReviewFieldList } from "@ui/features/review-queue/review-field-list";
import { UnlinkedDocumentsBanner } from "@ui/features/review-queue/unlinked-documents-banner";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const { account } = await getCurrentAccountAndUser();
  const [fields, subscriptions] = await Promise.all([
    listPendingReviewFields(account.id),
    listSubscriptions(account.id),
  ]);

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

  const isEmpty = linked.length === 0 && unlinkedDocuments.length === 0;

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
          {linked.length > 0 && <ReviewFieldList fields={linked} />}
        </>
      )}
    </div>
  );
}
