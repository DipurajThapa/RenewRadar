import { NextResponse } from "next/server";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { getSubscriptionDetail } from "@/lib/db/queries/subscriptions";
import { annualizeCents } from "@/lib/billing/annualize";
import {
  calculateNoticeDeadline,
  daysUntilNoticeDeadline,
} from "@/lib/notice-deadline/calculate";
import { scoreRisk } from "@/lib/risk/score";
import { renderPrepPackPdf } from "@/lib/pdf/prep-pack";

export const dynamic = "force-dynamic";

/**
 * Renewal Prep Pack PDF — gated by tenant scope.
 *
 * Returns a `Content-Disposition: attachment` PDF for the requested
 * subscription, or 404 if the subscription doesn't belong to the caller's
 * account. The auth check uses the same `getCurrentAccountAndUser()`
 * resolver as the rest of the app, so demo mode and Clerk paths behave
 * identically.
 */
export async function GET(
  _req: Request,
  { params }: { params: { subscriptionId: string } }
): Promise<NextResponse> {
  const { account } = await getCurrentAccountAndUser();
  const detail = await getSubscriptionDetail(account.id, params.subscriptionId);
  if (!detail) {
    return new NextResponse("Not found", { status: 404 });
  }

  const today = new Date();
  const noticeDeadlineDate = calculateNoticeDeadline(
    detail.subscription.termEndDate,
    detail.subscription.noticePeriodDays
  );
  const noticeDeadline = noticeDeadlineDate.toISOString().split("T")[0]!;
  const daysUntil = daysUntilNoticeDeadline(
    detail.subscription.termEndDate,
    detail.subscription.noticePeriodDays,
    today
  );
  const annualValueCents = annualizeCents(
    detail.subscription.totalCostPerPeriodCents,
    detail.subscription.billingCycle
  );
  const risk = scoreRisk({
    daysUntilNoticeDeadline: daysUntil,
    annualValueCents,
    autoRenew: detail.subscription.autoRenew,
    isMissed: detail.renewalEvent?.status === "missed",
  });

  const pdf = await renderPrepPackPdf({
    vendorName: detail.vendor.name,
    productName: detail.subscription.productName,
    planName: detail.subscription.planName,
    status: detail.renewalEvent?.status ?? detail.subscription.status,
    ownerName: detail.owner?.fullName ?? null,
    ownerEmail: detail.owner?.workEmail ?? null,
    termStartDate: detail.subscription.termStartDate,
    termEndDate: detail.subscription.termEndDate,
    noticeDeadline,
    noticePeriodDays: detail.subscription.noticePeriodDays,
    daysUntilNoticeDeadline: daysUntil,
    billingCycle: detail.subscription.billingCycle,
    totalSeats: detail.subscription.totalSeats,
    unitPriceCents: detail.subscription.unitPriceCents,
    totalCostPerPeriodCents: detail.subscription.totalCostPerPeriodCents,
    annualValueCents,
    autoRenew: detail.subscription.autoRenew,
    vendorCancellationEmail: detail.vendor.cancellationEmail,
    vendorCancellationUrl: detail.vendor.cancellationUrl,
    notes: detail.subscription.notes,
    riskScore: risk.score,
    riskBand: risk.band,
    accountName: account.name,
    generatedAtIso: today.toISOString(),
  });

  const filename = `prep-pack-${detail.vendor.name.toLowerCase().replace(/\s+/g, "-")}-${detail.subscription.termEndDate}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
