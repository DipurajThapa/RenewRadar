import { FileText, Inbox, Sparkles, Upload } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listDocuments } from "@server/infrastructure/db/repositories/documents";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { countPendingReviewFields } from "@server/infrastructure/db/repositories/ai-extractions";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";
import { getMonthlyPagesUsed } from "@server/infrastructure/db/repositories/ai-extractions";
import { PageHeader } from "@ui/components/shared/page-header";
import { StatCard } from "@ui/components/shared/stat-card";
import { EmptyState } from "@ui/components/shared/empty-state";
import { DocumentList } from "@ui/features/documents/document-list";
import { UploadDocumentButton } from "@ui/features/documents/upload-document-button";
import { BulkReExtractButton } from "@ui/features/documents/bulk-re-extract-button";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const [docs, subscriptions, pendingCount, monthlyPages] = await Promise.all([
    listDocuments(account.id),
    listSubscriptions(account.id),
    countPendingReviewFields(account.id),
    getMonthlyPagesUsed(account.id),
  ]);

  const tier = TIER_DEFINITIONS[account.planTier];
  const pageCap = tier.limits.aiExtractionPagesPerMonth;
  const remainingPages = Number.isFinite(pageCap)
    ? Math.max(0, pageCap - monthlyPages)
    : Number.POSITIVE_INFINITY;

  // For the subscription-attach dropdown in the upload dialog, expose minimal
  // info — the upload action validates account ownership again.
  const subscriptionOptions = subscriptions.map((s) => ({
    id: s.id,
    label: `${s.vendorName} — ${s.productName}`,
  }));

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeader.Row>
          <div className="space-y-2 min-w-0">
            <PageHeader.Title>Contracts</PageHeader.Title>
            <PageHeader.Description>
              Upload a contract and we extract the renewal date, notice
              period, auto-renew status, and price — with evidence quotes you
              can verify before anything updates.
            </PageHeader.Description>
          </div>
          <PageHeader.Actions>
            {(user.role === "owner" || user.role === "admin") && (
              <BulkReExtractButton documentCount={docs.length} />
            )}
            <UploadDocumentButton
              subscriptions={subscriptionOptions}
              remainingPages={remainingPages}
              planTier={account.planTier}
            />
          </PageHeader.Actions>
        </PageHeader.Row>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Contracts on file"
          value={docs.length.toLocaleString("en-US")}
          icon={<FileText />}
        />
        <StatCard
          label="Fields awaiting review"
          value={pendingCount.toString()}
          tone={pendingCount > 0 ? "primary" : "default"}
          icon={<Inbox />}
          sublabel={
            pendingCount > 0
              ? "Open the review queue to confirm"
              : "Nothing in the queue"
          }
        />
        <StatCard
          label="Pages extracted · this month"
          value={monthlyPages.toLocaleString("en-US")}
          icon={<Sparkles />}
          sublabel={
            Number.isFinite(pageCap) && pageCap > 0
              ? `${remainingPages.toLocaleString("en-US")} of ${pageCap.toLocaleString(
                  "en-US"
                )} remaining`
              : "Unlimited on your plan"
          }
        />
      </div>

      {docs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No contracts uploaded yet"
          description={
            <>
              Upload a contract to extract its renewal date, notice period,
              and price clauses. Every extracted field comes with a verbatim
              quote and page number so you can verify before it updates a
              subscription.
            </>
          }
          action={
            <UploadDocumentButton
              subscriptions={subscriptionOptions}
              remainingPages={remainingPages}
              planTier={account.planTier}
              label="Upload your first contract"
              variant="default"
              icon={<Upload className="mr-2 h-4 w-4" />}
            />
          }
        />
      ) : (
        <DocumentList documents={docs} />
      )}
    </div>
  );
}
