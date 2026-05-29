import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { formatCurrency, formatDate } from "@shared/utils";
import type { Subscription, Vendor } from "@server/infrastructure/db/schema";

export function DecideNowFacts({
  subscription,
  vendor,
}: {
  subscription: Subscription;
  vendor: Vendor;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What we know</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* `[max-content_1fr]` keeps the label column tight to its text on
            every screen so wide values (cancellation email, etc.) stay on
            one line. Falls back to fluid columns on very narrow phones via
            the natural wrap behaviour of grid items. */}
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-2 sm:gap-y-3 text-sm">
          <dt className="text-muted-foreground">Contracted seats</dt>
          <dd className="font-medium">{subscription.totalSeats}</dd>

          <dt className="text-muted-foreground">Unit price</dt>
          <dd className="font-medium">
            {formatCurrency(subscription.unitPriceCents)}
          </dd>

          <dt className="text-muted-foreground">Cost per period</dt>
          <dd className="font-medium">
            {formatCurrency(subscription.totalCostPerPeriodCents)}
          </dd>

          <dt className="text-muted-foreground">Billing cycle</dt>
          <dd className="font-medium capitalize">
            {subscription.billingCycle.replace(/_/g, " ")}
          </dd>

          <dt className="text-muted-foreground">Term ends</dt>
          <dd className="font-medium">{formatDate(subscription.termEndDate)}</dd>

          <dt className="text-muted-foreground">Notice period</dt>
          <dd className="font-medium">{subscription.noticePeriodDays} days</dd>

          <dt className="text-muted-foreground">Auto-renew</dt>
          <dd className="font-medium">{subscription.autoRenew ? "Yes" : "No"}</dd>

          {vendor.cancellationEmail && (
            <>
              <dt className="text-muted-foreground">Cancellation email</dt>
              <dd className="font-medium text-xs break-all">
                {vendor.cancellationEmail}
              </dd>
            </>
          )}
        </dl>

        {vendor.cancellationNotes && (
          <div className="pt-4 border-t text-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Vendor cancellation notes
            </div>
            <p className="text-muted-foreground whitespace-pre-wrap">
              {vendor.cancellationNotes}
            </p>
          </div>
        )}

        {subscription.notes && (
          <div className="pt-4 border-t text-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Your notes
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {subscription.notes}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
