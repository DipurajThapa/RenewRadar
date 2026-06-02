import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getSubscriptionDetail } from "@server/infrastructure/db/repositories/subscriptions";
import { listDocumentsForSubscription } from "@server/infrastructure/db/repositories/documents";
import { db } from "@server/infrastructure/db/client";
import { aiExtractedFieldsTable } from "@server/infrastructure/db/schema";
import { SubscriptionDetail } from "@ui/features/subscriptions/subscription-detail";
import { getLatestBrief } from "@server/application/renewal-brief";
import { getLatestNoticeDraft } from "@server/infrastructure/db/repositories/renewal-notice-drafts";
import { hasTierFeature } from "@server/domain/billing/tier-features";
import { RenewalBriefCard } from "@ui/features/renewal-brief/renewal-brief-card";
import { InternalNoticeDraft } from "@ui/features/renewal-notice/internal-notice-draft";
import { ActionPackagePanel } from "@ui/features/action-package/action-package-panel";
import { assembleActionPackage } from "@server/application/action-package";
import { fieldProvenance } from "@server/domain/provenance/labels";
import type { RenewalItemFacts } from "@server/domain/provenance/missing-info";
import type { RenewalIntelligenceBrief } from "@server/infrastructure/ai/reasoning/types";
import { formatDate, isUuid } from "@shared/utils";

export const dynamic = "force-dynamic";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // A garbage / non-UUID id used to flow into eq(uuid_col, …) and Postgres
  // would throw "invalid input syntax for type uuid", surfacing as a 500
  // error boundary instead of the not-found page. Short-circuit here.
  if (!isUuid(params.id)) {
    notFound();
  }
  const { account } = await getCurrentAccountAndUser();
  const detail = await getSubscriptionDetail(account.id, params.id);

  if (!detail) {
    notFound();
  }

  const [documents, pendingFields, latestBrief] = await Promise.all([
    listDocumentsForSubscription(account.id, detail.subscription.id),
    db
      .select({
        fieldKey: aiExtractedFieldsTable.fieldKey,
        confidence: aiExtractedFieldsTable.confidence,
        reviewStatus: aiExtractedFieldsTable.reviewStatus,
        evidenceQuote: aiExtractedFieldsTable.evidenceQuote,
      })
      .from(aiExtractedFieldsTable)
      .where(
        and(
          eq(aiExtractedFieldsTable.accountId, account.id),
          eq(aiExtractedFieldsTable.subscriptionId, detail.subscription.id),
          eq(aiExtractedFieldsTable.reviewStatus, "pending")
        )
      ),
    getLatestBrief(account.id, detail.subscription.id),
  ]);
  const pendingCount = pendingFields.length;
  const noticeDraft = await getLatestNoticeDraft(
    account.id,
    detail.subscription.id
  );

  // ─── Per-item action package (read-time view-model, S2) ──────────────────
  const sub = detail.subscription;
  const facts: RenewalItemFacts = {
    category: sub.category,
    termEndDate: sub.termEndDate ?? null,
    noticePeriodDays: sub.noticePeriodDays ?? null,
    totalCostPerPeriodCents: sub.totalCostPerPeriodCents ?? null,
    cancellationMethodCode: sub.cancellationMethodCode ?? null,
    priceIncreaseClauseText: sub.priceIncreaseClauseText ?? null,
    attributes: sub.attributesJson ?? {},
  };
  // A pending extracted field means we have an unverified guess for that fact —
  // it shows as "uncertain" (pending review) rather than flat "missing".
  const uncertainSignals = pendingFields.map((f) => ({
    fieldKey: f.fieldKey === "expiry_date" ? "renewal_date" : f.fieldKey,
    isUncertain: fieldProvenance(f.confidence, f.reviewStatus, !!f.evidenceQuote) !== "verified",
  }));
  const noticeDeadline = detail.renewalEvent?.noticeDeadline ?? null;
  const daysUntilNoticeDeadline = noticeDeadline
    ? Math.round(
        (new Date(`${noticeDeadline}T00:00:00Z`).getTime() -
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
          )) /
          86_400_000
      )
    : null;
  const actionPackage = assembleActionPackage({
    vendorName: detail.vendor.name,
    productName: sub.productName,
    facts,
    noticeDeadline,
    renewalDate: detail.renewalEvent?.renewalDate ?? null,
    daysUntilNoticeDeadline,
    brief: latestBrief ? (latestBrief.briefJson as RenewalIntelligenceBrief) : null,
    briefBySystem: latestBrief?.createdByUserId === null && latestBrief !== null,
    hasNoticeDraft: noticeDraft !== null,
    noticeDraftBySystem:
      noticeDraft?.createdByUserId === null && noticeDraft !== null,
    uncertainSignals,
    icsHref: `/api/calendar/item/${sub.id}`,
  });

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

      <RenewalBriefCard
        subscriptionId={detail.subscription.id}
        brief={
          latestBrief
            ? (latestBrief.briefJson as RenewalIntelligenceBrief)
            : null
        }
        generatedAt={latestBrief ? formatDate(latestBrief.createdAt) : null}
        canGenerate={hasTierFeature(account.planTier, "renewalBrief")}
      />

      <ActionPackagePanel pkg={actionPackage} subscriptionId={sub.id} />

      <InternalNoticeDraft
        subscriptionId={detail.subscription.id}
        draft={
          noticeDraft
            ? {
                id: noticeDraft.id,
                subject: noticeDraft.subject,
                bodyText: noticeDraft.bodyText,
                status: noticeDraft.status,
              }
            : null
        }
        canGenerate={hasTierFeature(account.planTier, "renewalBrief")}
        hasBrief={latestBrief !== null}
      />

      <SubscriptionDetail
        subscription={detail.subscription}
        vendor={detail.vendor}
        renewalEvent={detail.renewalEvent}
        owner={detail.owner}
        documents={documents}
        pendingFieldCount={pendingCount}
      />
    </div>
  );
}
