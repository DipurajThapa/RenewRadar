import { ShieldCheck } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listPendingReviewFields } from "@server/infrastructure/db/repositories/ai-extractions";
import { EmptyState } from "@ui/components/shared/empty-state";
import { ReviewFieldList } from "@ui/features/review-queue/review-field-list";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const { account } = await getCurrentAccountAndUser();
  const fields = await listPendingReviewFields(account.id);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-extracted fields awaiting your approval. Every field shows the
          verbatim quote from the contract. <strong>Nothing updates a
          subscription until you accept.</strong>
        </p>
      </header>

      {fields.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Nothing to review"
          description="When you upload a contract, extracted fields land here for your approval before they touch a subscription."
          variant="success"
        />
      ) : (
        <ReviewFieldList fields={fields} />
      )}
    </div>
  );
}
