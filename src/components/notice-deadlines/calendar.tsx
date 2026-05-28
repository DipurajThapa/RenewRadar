import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, daysUntil, formatCurrency, formatDate } from "@/lib/utils";
import {
  getUrgencyTone,
  urgencyClasses,
  type UrgencyTone,
} from "@/lib/notice-deadline/tone";
import { groupByMonth } from "@/lib/utils/group-by-month";
import type { NoticeDeadlineRow } from "@/lib/db/queries/notice-deadlines";

export function NoticeDeadlineCalendar({
  rows,
}: {
  rows: NoticeDeadlineRow[];
}) {
  const grouped = groupByMonth(rows, (r) => r.noticeDeadline);

  return (
    <div className="space-y-8">
      {grouped.map((group) => (
        <section key={group.monthKey}>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            {group.monthLabel}
          </h2>
          <div className="space-y-3">
            {group.rows.map((row) => (
              <DeadlineCard key={row.renewalEventId} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DeadlineCard({ row }: { row: NoticeDeadlineRow }) {
  const days = daysUntil(row.noticeDeadline);
  // Notice-deadline calendar overrides the default tone with "missed"
  // when the renewal event has been marked missed.
  const tone: UrgencyTone =
    row.status === "missed" ? "missed" : getUrgencyTone(days);
  const styles = urgencyClasses(tone);
  // The "missed" label here is more descriptive than the generic one
  const labelOverride =
    tone === "missed" ? "MISSED — auto-renewed" : styles.label;

  return (
    <Card
      className={cn(
        "border",
        styles.border,
        tone === "missed" ? "bg-gray-50" : ""
      )}
    >
      <CardContent className="p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={cn("h-2.5 w-2.5 rounded-full mt-2 shrink-0", styles.dot)}
            aria-hidden
          />
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
            </div>
            <div
              className={cn(
                "text-xs uppercase tracking-wide mt-1 font-medium",
                styles.text
              )}
            >
              {labelOverride}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Notice {row.status === "missed" ? "was due" : "due"}{" "}
              <span className={cn("font-medium", styles.text)}>
                {formatDate(row.noticeDeadline)}
              </span>
              {row.status !== "missed" && (
                <>
                  {" "}· in{" "}
                  <span className={cn("font-medium", styles.text)}>
                    {days} days
                  </span>
                </>
              )}
              {" · "}auto-renews{" "}
              <span className="font-medium">
                {formatDate(row.renewalDate)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(row.annualValueCents)}
            </div>
            <div className="text-xs text-muted-foreground">per year</div>
          </div>
          {row.status === "missed" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/subscriptions/${row.subscriptionId}`}>
                Document the loss →
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link
                href={`/subscriptions/${row.subscriptionId}/decide?event=${row.renewalEventId}`}
              >
                Decide now →
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
