import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Subscription, Vendor } from "@/lib/db/schema";

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
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
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
