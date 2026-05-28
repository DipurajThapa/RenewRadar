import { Card, CardContent } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import type { NoticeDeadlineKpis } from "@/lib/db/queries/notice-deadlines";

export function NoticeDeadlineKpiStrip({
  kpis,
}: {
  kpis: NoticeDeadlineKpis;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        label="Action needed"
        value={kpis.actionNeededIn7Days}
        sublabel="in next 7 days"
        tone={kpis.actionNeededIn7Days > 0 ? "urgent" : "ok"}
      />
      <KpiCard
        label="In notice window"
        value={kpis.inNoticeWindow}
        sublabel={
          kpis.inNoticeWindow > 0
            ? `${formatCurrency(kpis.inNoticeWindowValueCents)} at stake`
            : "none right now"
        }
        tone={kpis.inNoticeWindow > 0 ? "moderate" : "ok"}
      />
      <KpiCard
        label="Upcoming 90 days"
        value={kpis.upcomingNext90}
        sublabel={
          kpis.upcomingNext90 > 0
            ? formatCurrency(kpis.upcomingNext90ValueCents)
            : "—"
        }
        tone="neutral"
      />
      <KpiCard
        label="Missed YTD"
        value={kpis.missedYtd}
        sublabel={
          kpis.missedYtd > 0
            ? formatCurrency(kpis.missedYtdValueCents)
            : "none — good"
        }
        tone={kpis.missedYtd > 0 ? "missed" : "ok"}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: number;
  sublabel: string;
  tone: "urgent" | "moderate" | "neutral" | "missed" | "ok";
}) {
  const toneClass = {
    urgent: "border-red-300 bg-red-50",
    moderate: "border-orange-300 bg-orange-50",
    neutral: "",
    missed: "border-gray-400 bg-gray-100",
    ok: "border-green-200 bg-green-50",
  }[tone];

  return (
    <Card className={cn("border", toneClass)}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>
      </CardContent>
    </Card>
  );
}
