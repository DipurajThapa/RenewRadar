import { Card, CardContent } from "@ui/components/primitives/card";
import { formatCurrency } from "@shared/utils";
import type { DashboardKpis } from "@server/infrastructure/db/repositories/dashboard";

export function KpiStrip({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi
        label="Tracked subscriptions"
        value={kpis.trackedSubscriptions.toString()}
        sublabel={
          kpis.trackedSubscriptionsAddedThisMonth > 0
            ? `+${kpis.trackedSubscriptionsAddedThisMonth} this month`
            : "no change this month"
        }
      />
      <Kpi
        label="Annualized spend"
        value={formatCurrency(kpis.totalAnnualSpendCents)}
        sublabel="across active subscriptions"
      />
      <Kpi
        label="Notice deadlines, next 30d"
        value={kpis.noticeDeadlinesNext30Count.toString()}
        sublabel={
          kpis.noticeDeadlinesNext30Count > 0
            ? `${formatCurrency(kpis.noticeDeadlinesNext30ValueCents)} at stake`
            : "you're caught up"
        }
      />
      <Kpi
        label="Reclamation savings YTD"
        value="$0"
        sublabel="coming in V1.5"
        muted
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sublabel,
  muted,
}: {
  label: string;
  value: string;
  sublabel: string;
  muted?: boolean;
}) {
  return (
    <Card className={muted ? "opacity-70" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div className="text-2xl md:text-3xl font-bold mt-1 tabular-nums">
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>
      </CardContent>
    </Card>
  );
}
