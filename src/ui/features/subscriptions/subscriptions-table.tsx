import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@ui/components/primitives/badge";
import { cn, daysUntil, formatCurrency, formatDate } from "@shared/utils";
import { calculateNoticeDeadline } from "@server/domain/notice-deadline/calculate";
import { urgencyClasses } from "@server/domain/notice-deadline/tone";
import { annualizeCents } from "@server/domain/billing/annualize";
import { getStatusBadgeVariant } from "@server/domain/subscriptions/status-badge";
import type { SubscriptionRow } from "@server/infrastructure/db/repositories/subscriptions";

export function SubscriptionsTable({
  subscriptions,
}: {
  subscriptions: SubscriptionRow[];
}) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="hidden md:grid md:grid-cols-[2fr_0.9fr_0.7fr_1fr_1fr_1fr_0.9fr_auto] gap-3 px-4 py-3 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
        <div>Vendor — Product</div>
        <div>Owner</div>
        <div className="text-right">Seats</div>
        <div className="text-right">Annual</div>
        <div>Renewal</div>
        <div>Notice deadline</div>
        <div>Status</div>
        <div />
      </div>
      <ul className="divide-y">
        {subscriptions.map((sub) => (
          <li key={sub.id}>
            <SubscriptionListItem sub={sub} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubscriptionListItem({ sub }: { sub: SubscriptionRow }) {
  const noticeDeadline = calculateNoticeDeadline(
    sub.termEndDate,
    sub.noticePeriodDays
  );
  const noticeDays = daysUntil(noticeDeadline);
  const renewalDays = daysUntil(sub.termEndDate);
  const annualCost = annualizeCents(
    sub.totalCostPerPeriodCents,
    sub.billingCycle
  );
  const noticeTone = urgencyClasses(noticeDays);

  return (
    <Link
      href={`/subscriptions/${sub.id}`}
      className="block hover:bg-muted/30 transition-colors"
    >
      <div className="grid grid-cols-1 md:grid-cols-[2fr_0.9fr_0.7fr_1fr_1fr_1fr_0.9fr_auto] gap-3 px-4 py-3 items-center text-sm">
        {/* Vendor + product */}
        <div className="min-w-0">
          <div className="font-medium truncate">{sub.vendorName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {sub.productName}
            {sub.planName ? ` · ${sub.planName}` : ""}
          </div>
        </div>

        {/* Owner */}
        <div className="hidden md:block min-w-0">
          {sub.ownerUserId ? (
            <div className="truncate text-sm">
              {sub.ownerName ?? sub.ownerEmail ?? "—"}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Unassigned
            </div>
          )}
        </div>

        {/* Seats */}
        <div className="text-right tabular-nums hidden md:block">
          {sub.totalSeats}
        </div>

        {/* Annual cost */}
        <div className="text-right tabular-nums hidden md:block">
          {formatCurrency(annualCost)}
        </div>

        {/* Renewal date */}
        <div className="hidden md:block">
          <div className="tabular-nums">{formatDate(sub.termEndDate)}</div>
          <div className="text-xs text-muted-foreground">
            in {renewalDays} days
          </div>
        </div>

        {/* Notice deadline */}
        <div className="hidden md:block">
          <div className={cn("tabular-nums font-medium", noticeTone.text)}>
            {formatDate(noticeDeadline)}
          </div>
          <div className={cn("text-xs", noticeTone.text)}>
            in {noticeDays} days
          </div>
        </div>

        {/* Status */}
        <div className="hidden md:block">
          <Badge
            variant={getStatusBadgeVariant(sub.status)}
            className="capitalize"
          >
            {sub.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground hidden md:block" />

        {/* Mobile inline summary — replaces every hidden column at one go
            so the row still tells the story without horizontal scroll. */}
        <div className="md:hidden mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Badge
              variant={getStatusBadgeVariant(sub.status)}
              className="capitalize"
            >
              {sub.status.replace(/_/g, " ")}
            </Badge>
            <span className="tabular-nums font-medium">
              {formatCurrency(annualCost)}/yr
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{sub.totalSeats} seats</span>
            <span className={cn("font-medium tabular-nums", noticeTone.text)}>
              Notice in {noticeDays}d
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
