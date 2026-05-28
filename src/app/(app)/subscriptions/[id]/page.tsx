import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { listDocumentsForSubscription } from "@server/infrastructure/db/repositories/documents";
import { db } from "@server/infrastructure/db/client";
import { aiExtractedFieldsTable } from "@server/infrastructure/db/schema";
import { SubscriptionDetail } from "@ui/features/subscriptions/subscription-detail";

export const dynamic = "force-dynamic";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const detail = await getSubscriptionDetail(account.id, params.id);

  if (!detail) {
    notFound();
  }

  const [documents, pendingCount] = await Promise.all([
    listDocumentsForSubscription(account.id, detail.subscription.id),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiExtractedFieldsTable)
      .where(
        and(
          eq(aiExtractedFieldsTable.accountId, account.id),
          eq(aiExtractedFieldsTable.subscriptionId, detail.subscription.id),
          eq(aiExtractedFieldsTable.reviewStatus, "pending")
        )
      ),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/subscriptions"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to subscriptions
        </Link>
      </div>

      <SubscriptionDetail
        subscription={detail.subscription}
        vendor={detail.vendor}
        renewalEvent={detail.renewalEvent}
        owner={detail.owner}
        documents={documents}
        pendingFieldCount={pendingCount[0]?.count ?? 0}
      />
    </div>
  );
}
