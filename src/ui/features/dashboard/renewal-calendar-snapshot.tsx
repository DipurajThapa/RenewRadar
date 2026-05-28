import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { formatCurrency, formatDate } from "@shared/utils";
import type { MonthBucket, SpotlightRow } from "@server/infrastructure/db/repositories/dashboard";

export function RenewalCalendarSnapshot({
  monthBuckets,
  topThree,
}: {
  monthBuckets: MonthBucket[];
  topThree: SpotlightRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Renewal calendar — next 12 months</CardTitle>
        <Link
          href="/renewals"
          className="text-sm text-muted-foreground hover:underline"
        >
          Open calendar →
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <MonthBars buckets={monthBuckets} />

        {topThree.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Next 3 renewals
            </div>
            {topThree.map((row) => (
              <Link
                key={row.renewalEventId}
                href={`/subscriptions/${row.subscriptionId}`}
                className="flex items-center justify-between text-sm py-1 hover:bg-muted/30 rounded-md -mx-2 px-2 transition-colors"
              >
                <span className="truncate">
                  <span className="font-medium">{row.vendorName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {row.productName}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0 ml-3 text-xs">
                  {formatDate(row.noticeDeadline)} ·{" "}
                  {formatCurrency(row.annualValueCents)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MonthBars({ buckets }: { buckets: MonthBucket[] }) {
  const months = generateNext12Months();
  const bucketMap = new Map(buckets.map((b) => [b.monthKey, b]));
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex items-end justify-between gap-1 h-20" role="img" aria-label="Renewal counts by month">
      {months.map((month) => {
        const bucket = bucketMap.get(month.key);
        const height = bucket ? Math.max(8, (bucket.count / maxCount) * 64) : 4;
        const isEmpty = !bucket;
        const title = bucket
          ? `${month.label}: ${bucket.count} ${bucket.count === 1 ? "renewal" : "renewals"}, ${formatCurrency(bucket.totalValueCents)}`
          : `${month.label}: no renewals`;
        return (
          <div
            key={month.key}
            className="flex-1 flex flex-col items-center gap-1.5"
          >
            <div
              className={
                isEmpty
                  ? "w-full max-w-6 rounded-t bg-muted"
                  : "w-full max-w-6 rounded-t bg-foreground transition-all"
              }
              style={{ height: `${height}px` }}
              title={title}
            />
            <div className="text-[10px] text-muted-foreground">
              {month.shortLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function generateNext12Months() {
  const months: { key: string; label: string; shortLabel: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      shortLabel: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).slice(0, 1),
    });
  }
  return months;
}
