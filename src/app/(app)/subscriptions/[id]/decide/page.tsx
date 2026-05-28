import Link from "next/link";
import { ArrowLeft, TrendingDown } from "lucide-react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { getRenewalEventWithContext } from "@/lib/db/queries/renewals";
import { getSavingsForRenewalEvent } from "@/lib/db/queries/savings";
import { DecideNowHeader } from "@/components/decide-now/header";
import { DecideNowFacts } from "@/components/decide-now/facts";
import { DecideNowForm } from "@/components/decide-now/form";
import { formatCurrency, formatDate } from "@/lib/utils";
import { annualizeCents } from "@/lib/billing/annualize";
import type { SavingsRow } from "@/lib/db/queries/savings";

type Props = {
  params: { id: string };
  searchParams: { event?: string };
};

export const dynamic = "force-dynamic";

export default async function DecideNowPage({ params, searchParams }: Props) {
  const { account, user } = await getCurrentAccountAndUser();

  if (!searchParams.event) {
    notFound();
  }

  const data = await getRenewalEventWithContext(account.id, searchParams.event);

  if (!data || data.subscription.id !== params.id) {
    notFound();
  }

  // If the decision is already logged, show a read-only summary instead of the form
  if (data.renewalEvent.decision) {
    const savings = await getSavingsForRenewalEvent(
      account.id,
      data.renewalEvent.id
    );
    return (
      <AlreadyDecided
        subscriptionId={data.subscription.id}
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        decision={data.renewalEvent.decision}
        decisionAt={data.renewalEvent.decisionAt}
        decisionNote={data.renewalEvent.decisionNote}
        savings={savings}
      />
    );
  }

  const annualValueCents = annualizeCents(
    data.subscription.totalCostPerPeriodCents,
    data.subscription.billingCycle
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/notice-deadlines"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to notice deadlines
        </Link>
      </div>

      <DecideNowHeader
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        noticeDeadline={data.renewalEvent.noticeDeadline}
        annualValueCents={annualValueCents}
      />

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="py-4 text-sm text-amber-900">
          <strong>The stakes:</strong> If you do nothing,{" "}
          {data.vendor.name} auto-renews on{" "}
          {formatDate(data.subscription.termEndDate)} for{" "}
          ${(annualValueCents / 100).toLocaleString("en-US")} per year. The
          notice deadline is the last day you can prevent that.
        </CardContent>
      </Card>

      <DecideNowFacts
        subscription={data.subscription}
        vendor={data.vendor}
      />

      <DecideNowForm
        renewalEventId={data.renewalEvent.id}
        subscriptionId={data.subscription.id}
        currentTotalSeats={data.subscription.totalSeats}
        currentUnitPriceCents={data.subscription.unitPriceCents}
        vendorName={data.vendor.name}
        productName={data.subscription.productName}
        termEndDate={data.subscription.termEndDate}
        vendorCancellationEmail={data.vendor.cancellationEmail}
        vendorCancellationUrl={data.vendor.cancellationUrl}
        defaultCustomerName={user.fullName ?? undefined}
        defaultCompanyName={account.name}
      />
    </div>
  );
}

function AlreadyDecided({
  subscriptionId,
  vendorName,
  productName,
  decision,
  decisionAt,
  decisionNote,
  savings,
}: {
  subscriptionId: string;
  vendorName: string;
  productName: string;
  decision: string;
  decisionAt: Date | null;
  decisionNote: string | null;
  savings: SavingsRow | null;
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/notice-deadlines"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to notice deadlines
        </Link>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">{vendorName}</p>
        <h1 className="text-2xl font-semibold mt-1">{productName}</h1>
      </div>

      <Card>
        <CardContent className="py-6 space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="capitalize">{decision.replace(/_/g, " ")}</Badge>
            {decisionAt && (
              <span className="text-sm text-muted-foreground">
                logged {formatDate(decisionAt)}
              </span>
            )}
          </div>
          <p className="text-sm">
            You've already logged a decision for this renewal. Future
            notice-deadline alerts for it are suppressed.
          </p>
          {decisionNote && (
            <div className="pt-3 border-t">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Decision note
              </div>
              <p className="text-sm whitespace-pre-wrap">{decisionNote}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {savings && savings.savedAnnualUsdCents > 0 && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-5 space-y-2">
            <div className="flex items-center gap-2 text-green-900">
              <TrendingDown className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                Saved
              </span>
            </div>
            <div className="text-3xl font-bold text-green-900 tabular-nums">
              {formatCurrency(savings.savedAnnualUsdCents)}
              <span className="text-sm text-green-700 font-normal ml-2">
                / year
              </span>
            </div>
            <div className="text-xs text-green-800">
              Baseline {formatCurrency(savings.baselineAnnualUsdCents)} →{" "}
              {formatCurrency(savings.newAnnualUsdCents)} after this decision.
              {savings.isLocked
                ? " This entry is locked."
                : " Editable for 30 days from the decision date."}
            </div>
            <div className="text-xs text-green-700 pt-1">
              Counts toward your savings ledger in{" "}
              <Link href="/reports" className="underline underline-offset-4">
                Reports
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      )}

      <Button asChild variant="outline">
        <Link href={`/subscriptions/${subscriptionId}`}>
          View subscription detail →
        </Link>
      </Button>
    </div>
  );
}

// annualizeCents moved to @/lib/billing/annualize
