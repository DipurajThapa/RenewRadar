import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Card } from "@ui/components/primitives/card";
import { cn } from "@shared/utils";

/**
 * StatCard — a single big number with a label, supporting sublabel, and an
 * optional delta indicator.
 *
 * Used on the dashboard KPI strip and elsewhere we want the headline to
 * dominate. The card is intentionally generous (p-6) so a row of 4 of these
 * doesn't look like an Excel spreadsheet.
 *
 *   tone="default"   neutral card (default)
 *   tone="primary"   indigo-tinted, used for the "headline" KPI on a strip
 *   tone="success"   emerald-tinted, used for revenue / savings positives
 *
 * Pass `delta={{ value: "+3", trend: "up" }}` to render the small arrow chip.
 */
export type StatCardTone = "default" | "primary" | "success";
type DeltaTrend = "up" | "down" | "flat";

export interface StatCardProps {
  label: string;
  value: string;
  sublabel?: React.ReactNode;
  tone?: StatCardTone;
  delta?: { value: string; trend: DeltaTrend };
  icon?: React.ReactNode;
  className?: string;
}

const toneStyles: Record<
  StatCardTone,
  { card: string; label: string; value: string; sublabel: string }
> = {
  default: {
    card: "",
    label: "text-muted-foreground",
    value: "text-foreground",
    sublabel: "text-muted-foreground",
  },
  primary: {
    card: "border-primary/20 bg-primary-soft/60",
    label: "text-primary-strong/80",
    value: "text-primary-strong",
    sublabel: "text-primary-strong/70",
  },
  success: {
    card: "border-success/20 bg-success-soft/70",
    label: "text-success-soft-foreground/80",
    value: "text-success-soft-foreground",
    sublabel: "text-success-soft-foreground/80",
  },
};

const deltaIcon: Record<DeltaTrend, React.ReactNode> = {
  up: <ArrowUp className="h-3 w-3" />,
  down: <ArrowDown className="h-3 w-3" />,
  flat: <ArrowRight className="h-3 w-3" />,
};

const deltaTone: Record<DeltaTrend, string> = {
  up: "bg-success-soft text-success-soft-foreground border-success/15",
  down: "bg-destructive-soft text-destructive-soft-foreground border-destructive/15",
  flat: "bg-muted text-muted-foreground border-border",
};

export function StatCard({
  label,
  value,
  sublabel,
  tone = "default",
  delta,
  icon,
  className,
}: StatCardProps) {
  const s = toneStyles[tone];
  return (
    <Card className={cn(s.card, "p-5 flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "text-[11px] font-medium uppercase tracking-[0.12em]",
            s.label
          )}
        >
          {label}
        </div>
        {icon && (
          <div className="text-muted-foreground/70 [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div
          className={cn(
            "text-2xl md:text-3xl font-semibold tabular-nums tracking-tight leading-none",
            s.value
          )}
        >
          {value}
        </div>
        {delta && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              deltaTone[delta.trend]
            )}
          >
            {deltaIcon[delta.trend]}
            <span className="tabular-nums">{delta.value}</span>
          </div>
        )}
      </div>
      {sublabel && (
        <div className={cn("text-xs leading-relaxed", s.sublabel)}>
          {sublabel}
        </div>
      )}
    </Card>
  );
}
