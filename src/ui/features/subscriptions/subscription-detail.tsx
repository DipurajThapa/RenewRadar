import Link from "next/link";
import { Pencil, User as UserIcon, FileDown } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { cn, daysUntil, formatCurrency, formatDate } from "@shared/utils";
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import { urgencyClasses } from "@server/domain/notice-deadline/tone";
import { annualizeCents } from "@server/domain/billing/annualize";
import { getStatusBadgeVariant } from "@server/domain/subscriptions/status-badge";
import type { Subscription, Vendor, RenewalEvent } from "@server/infrastructure/db/schema";
import { DeleteSubscriptionButton } from "./delete-button";

type OwnerInfo = {
  id: string;
  fullName: string | null;
  workEmail: string;
} | null;

export function SubscriptionDetail({
  subscription,
  vendor,
  renewalEvent,
  owner,
}: {
  subscription: Subscription;
  vendor: Vendor;
  renewalEvent: RenewalEvent | null;
  owner: OwnerInfo;
}) {
  const noticeDeadline = calculateNoticeDeadline(
    subscription.termEndDate,
    subscription.noticePeriodDays
  );
  const noticeDays = daysUntil(noticeDeadline);
  const renewalDays = daysUntil(subscription.termEndDate);
  const annualCost = annualizeCents(
    subscription.totalCostPerPeriodCents,
    subscription.billingCycle
  );
  const noticeTone = urgencyClasses(noticeDays);

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{vendor.name}</p>
          <h1 className="text-2xl font-semibold mt-1">
            {subscription.productName}
            {subscription.planName && (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {subscription.planName}
              </span>
            )}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={getStatusBadgeVariant(subscription.status)} className="capitalize">
              {subscription.status.replace(/_/g, " ")}
            </Badge>
            <Badge
              variant={owner ? "secondary" : "outline"}
              className="font-normal"
              title={owner?.workEmail ?? "No owner assigned"}
            >
              <UserIcon className="mr-1 h-3 w-3" />
              {owner
                ? owner.fullName ?? owner.workEmail
                : "Owner: unassigned"}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="outline">
            <Link
              href={`/api/prep-pack/${subscription.id}`}
              prefetch={false}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Prep Pack PDF
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/subscriptions/${subscription.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <DeleteSubscriptionButton
            subscriptionId={subscription.id}
            vendorName={vendor.name}
            productName={subscription.productName}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Notice deadline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-3xl font-bold", noticeTone.text)}>
              {formatDate(noticeDeadline)}
            </div>
            <div className={cn("text-sm mt-1", noticeTone.text)}>
              in {noticeDays} days
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              To cancel or renegotiate <strong>{vendor.name}</strong>, give
              written notice by this date or the subscription auto-renews for
              another {subscription.billingCycle.replace(/_/g, " ")} term at{" "}
              {formatCurrency(subscription.totalCostPerPeriodCents)}.
            </p>
            {renewalEvent && (
              <Button asChild className="mt-4 w-full" variant="default">
                <Link
                  href={`/subscriptions/${subscription.id}/decide?event=${renewalEvent.id}`}
                >
                  Log a decision
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key facts</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Billing cycle</dt>
              <dd className="capitalize">
                {subscription.billingCycle.replace(/_/g, " ")}
              </dd>

              <dt className="text-muted-foreground">Seats</dt>
              <dd>{subscription.totalSeats}</dd>

              <dt className="text-muted-foreground">Unit price</dt>
              <dd>{formatCurrency(subscription.unitPriceCents)}</dd>

              <dt className="text-muted-foreground">Per period</dt>
              <dd>{formatCurrency(subscription.totalCostPerPeriodCents)}</dd>

              <dt className="text-muted-foreground">Annualized</dt>
              <dd className="font-medium">{formatCurrency(annualCost)}</dd>

              <dt className="text-muted-foreground">Term start</dt>
              <dd>{formatDate(subscription.termStartDate)}</dd>

              <dt className="text-muted-foreground">Term end</dt>
              <dd>
                {formatDate(subscription.termEndDate)}{" "}
                <span className="text-muted-foreground">
                  (in {renewalDays} days)
                </span>
              </dd>

              <dt className="text-muted-foreground">Notice period</dt>
              <dd>{subscription.noticePeriodDays} days</dd>

              <dt className="text-muted-foreground">Auto-renew</dt>
              <dd>{subscription.autoRenew ? "Yes" : "No"}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      {subscription.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">
            {subscription.notes}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cancellation assistant</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When you decide to cancel, we generate the cancellation letter
            draft for you to send from your own email. Renewal Radar never
            sends emails to vendors on your behalf.
          </p>
          {renewalEvent && (
            <Button asChild variant="outline" className="mt-4">
              <Link
                href={`/subscriptions/${subscription.id}/decide?event=${renewalEvent.id}`}
              >
                Open Decide-Now flow
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// annualize, toneForDays, badgeVariant moved to canonical lib modules:
//   @/lib/billing/annualize         (annualizeCents)
//   @/lib/notice-deadline/tone      (urgencyClasses, getUrgencyTone)
//   @/lib/subscriptions/status-badge (getStatusBadgeVariant)
