import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { cn, daysUntil, formatCurrency, formatDate } from "@shared/utils";
import { urgencyClasses } from "@server/domain/notice-deadline/tone";
import type { SpotlightRow } from "@server/infrastructure/db/repositories/dashboard";

/**
 * Notice deadline spotlight — the most urgent N rows from the notice
 * deadlines table, surfaced on the dashboard.
 *
 * Each row is a flat link to the subscription detail page. Visual cues:
 *   - tone dot     — at-a-glance urgency (red/amber/blue/grey)
 *   - tone text    — repeats the label for accessibility
 *   - currency     — right-aligned, tabular numerals, with /yr label
 *
 * The whole row has hover affordance + an arrow chevron on hover so the
 * user knows it's clickable without making it look like a button.
 */
export function NoticeDeadlineSpotlight({
  rows,
  totalCount,
}: {
  rows: SpotlightRow[];
  totalCount: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>Notice deadline spotlight</CardTitle>
          <CardDescription>
            The most urgent deadlines — click any row to open the decision flow.
          </CardDescription>
        </div>
        {totalCount > rows.length && (
          <Link
            href="/notice-deadlines"
            className="text-sm text-primary-strong font-medium hover:underline shrink-0 mt-1"
          >
            View all {totalCount} →
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <SpotlightItem key={row.renewalEventId} row={row} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SpotlightItem({ row }: { row: SpotlightRow }) {
  const days = daysUntil(row.noticeDeadline);
  const tone = urgencyClasses(days);

  return (
    <li>
      <Link
        href={`/subscriptions/${row.subscriptionId}`}
        className="group flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-secondary/40 transition-colors rounded-md"
      >
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0 ring-4 ring-offset-0",
              tone.dot,
              "ring-current/10"
            )}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-medium text-sm truncate">
              {row.vendorName}
              <span className="text-muted-foreground font-normal">
                {" "}— {row.productName}
              </span>
            </div>
            <div className={cn("text-xs", tone.text)}>
              <span className="font-medium uppercase tracking-wide">
                {tone.label}
              </span>{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="tabular-nums">in {days} days</span>{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="tabular-nums">{formatDate(row.noticeDeadline)}</span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 flex items-center gap-2.5">
          <div>
            <div className="text-sm font-semibold tabular-nums">
              {formatCurrency(row.annualValueCents)}
            </div>
            <div className="text-[11px] text-muted-foreground">per year</div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </Link>
    </li>
  );
}
