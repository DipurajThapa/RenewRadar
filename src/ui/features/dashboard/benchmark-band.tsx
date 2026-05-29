import { Users } from "lucide-react";
import { Card, CardContent } from "@ui/components/primitives/card";

export type DashboardBenchmarkRow = {
  vendorName: string;
  yourNoticePeriodDays: number;
  typicalNoticePeriodDays: number | null;
  yourAutoRenew: boolean;
  typicalAutoRenewRatePct: number | null;
  sampleAccounts: number;
};

/**
 * Dashboard "your top vendors vs typical" band.
 *
 * Surfaces the cross-account moat above the fold: for the account's
 * biggest vendors, show how the user's notice period + auto-renew
 * compare to the anonymized cross-account aggregate. Only rows where the
 * privacy floor was met (sampleAccounts >= MIN_BENCHMARK_SAMPLE) appear
 * — the aggregator already filters; this component just renders.
 *
 * No-op when there's nothing to show — most accounts in the first weeks
 * after launch will see an empty band because the cross-account sample
 * isn't there yet. That's fine; the band is opt-in based on data.
 */
export function DashboardBenchmarkBand({
  rows,
}: {
  rows: DashboardBenchmarkRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary-soft/20">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-primary-strong" />
          <span className="font-semibold">Your top vendors vs typical</span>
          <span className="text-xs text-muted-foreground">
            Anonymized aggregate from other customers
          </span>
        </div>
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li
              key={r.vendorName}
              className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 items-baseline"
            >
              <div className="font-medium truncate">{r.vendorName}</div>
              <NoticeComparison
                yours={r.yourNoticePeriodDays}
                typical={r.typicalNoticePeriodDays}
              />
              <AutoRenewComparison
                yours={r.yourAutoRenew}
                typicalPct={r.typicalAutoRenewRatePct}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                n={r.sampleAccounts}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground italic">
          Patterns only — not legal advice or a guarantee of outcomes.
        </p>
      </CardContent>
    </Card>
  );
}

function NoticeComparison({
  yours,
  typical,
}: {
  yours: number;
  typical: number | null;
}) {
  if (typical === null) {
    return (
      <span className="text-xs text-muted-foreground">
        Notice: {yours}d
      </span>
    );
  }
  const aboveTypical = yours > typical;
  return (
    <span className="text-xs">
      Notice: <span className="tabular-nums">{yours}d</span>{" "}
      <span className="text-muted-foreground">
        (typical {typical}d){" "}
        {aboveTypical && (
          <span className="text-amber-700">— shorter window than peers</span>
        )}
      </span>
    </span>
  );
}

function AutoRenewComparison({
  yours,
  typicalPct,
}: {
  yours: boolean;
  typicalPct: number | null;
}) {
  if (typicalPct === null) {
    return (
      <span className="text-xs text-muted-foreground">
        Auto-renew: {yours ? "yes" : "no"}
      </span>
    );
  }
  return (
    <span className="text-xs">
      Auto-renew: {yours ? "yes" : "no"}{" "}
      <span className="text-muted-foreground">
        ({typicalPct}% of peers do)
      </span>
    </span>
  );
}
