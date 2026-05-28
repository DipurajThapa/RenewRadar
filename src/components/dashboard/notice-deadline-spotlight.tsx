import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, daysUntil, formatCurrency, formatDate } from "@/lib/utils";
import { urgencyClasses } from "@/lib/notice-deadline/tone";
import type { SpotlightRow } from "@/lib/db/queries/dashboard";

export function NoticeDeadlineSpotlight({
  rows,
  totalCount,
}: {
  rows: SpotlightRow[];
  totalCount: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Notice deadline spotlight</CardTitle>
        {totalCount > rows.length && (
          <Link
            href="/notice-deadlines"
            className="text-sm text-muted-foreground hover:underline"
          >
            View all {totalCount} →
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <SpotlightItem key={row.renewalEventId} row={row} />
        ))}
      </CardContent>
    </Card>
  );
}

function SpotlightItem({ row }: { row: SpotlightRow }) {
  const days = daysUntil(row.noticeDeadline);
  const tone = urgencyClasses(days);

  return (
    <Link
      href={`/subscriptions/${row.subscriptionId}`}
      className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0 last:pb-0 hover:bg-muted/30 rounded-md -mx-2 px-2 py-1 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", tone.dot)} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">
            {row.vendorName}{" "}
            <span className="text-muted-foreground font-normal">
              — {row.productName}
            </span>
          </div>
          <div className={cn("text-xs mt-0.5", tone.text)}>
            <span className="font-medium">{tone.label}</span> · in {days} days ·{" "}
            {formatDate(row.noticeDeadline)}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 ml-3">
        <div className="text-sm font-medium tabular-nums">
          {formatCurrency(row.annualValueCents)}
        </div>
        <div className="text-xs text-muted-foreground">per year</div>
      </div>
    </Link>
  );
}
