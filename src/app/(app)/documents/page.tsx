import Link from "next/link";
import { FileText, Upload } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listDocuments } from "@server/infrastructure/db/repositories/documents";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { countPendingReviewFields } from "@server/infrastructure/db/repositories/ai-extractions";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";
import { getMonthlyPagesUsed } from "@server/infrastructure/db/repositories/ai-extractions";
import { Card, CardContent } from "@ui/components/primitives/card";
import { EmptyState } from "@ui/components/shared/empty-state";
import { DocumentList } from "@ui/features/documents/document-list";
import { UploadDocumentButton } from "@ui/features/documents/upload-document-button";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { account } = await getCurrentAccountAndUser();
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
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contracts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a contract and we'll extract the renewal date, notice
            period, auto-renew status, and price — with evidence quotes you
            can verify before anything updates.
          </p>
        </div>
        <UploadDocumentButton
          subscriptions={subscriptionOptions}
          remainingPages={remainingPages}
        />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Contracts on file
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-2">
              {docs.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Fields awaiting your review
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-2">
              {pendingCount > 0 ? (
                <Link
                  href="/review-queue"
                  className="hover:underline text-amber-700"
                >
                  {pendingCount} →
                </Link>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Pages extracted this month
            </div>
            <div className="text-2xl font-semibold tabular-nums mt-2">
              {monthlyPages.toLocaleString("en-US")}
              {Number.isFinite(pageCap) && (
                <span className="text-base text-muted-foreground ml-1">
                  / {pageCap.toLocaleString("en-US")}
                </span>
              )}
            </div>
            {Number.isFinite(pageCap) && pageCap > 0 && (
              <div className="text-xs text-muted-foreground">
                {remainingPages.toLocaleString("en-US")} pages remaining
              </div>
            )}
          </CardContent>
        </Card>
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
