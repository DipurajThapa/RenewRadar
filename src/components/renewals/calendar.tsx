import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { daysUntil, formatCurrency, formatDate } from "@/lib/utils";
import { groupByMonth } from "@/lib/utils/group-by-month";
import type { RenewalCalendarRow } from "@/lib/db/queries/renewals";

export function RenewalCalendar({ rows }: { rows: RenewalCalendarRow[] }) {
  const grouped = groupByMonth(rows, (r) => r.renewalDate);
  return (
    <div className="space-y-8">
      {grouped.map((group) => (
        <section key={group.monthKey}>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            {group.monthLabel}
          </h2>
          <div className="space-y-3">
            {group.rows.map((row) => (
              <RenewalCard key={row.renewalEventId} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RenewalCard({ row }: { row: RenewalCalendarRow }) {
  const days = daysUntil(row.renewalDate);
  const noticeDays = daysUntil(row.noticeDeadline);

  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{row.vendorName}</span>
            <span className="text-muted-foreground text-sm">
              — {row.productName}
            </span>
            {row.planName && (
              <span className="text-muted-foreground text-xs">
                · {row.planName}
              </span>
            )}
            {row.decision && (
              <Badge variant="outline" className="ml-2 capitalize">
                {row.decision.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Renews{" "}
            <span className="font-medium">{formatDate(row.renewalDate)}</span>{" "}
            · in <span className="font-medium">{days} days</span> · notice
            deadline{" "}
            <span className="font-medium">{formatDate(row.noticeDeadline)}</span>
            {noticeDays > 0 && <> (in {noticeDays} days)</>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(row.annualValueCents)}
            </div>
            <div className="text-xs text-muted-foreground">per year</div>
          </div>
          {row.decision ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/subscriptions/${row.subscriptionId}`}>View →</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link
                href={`/subscriptions/${row.subscriptionId}/decide?event=${row.renewalEventId}`}
              >
                Decide →
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
