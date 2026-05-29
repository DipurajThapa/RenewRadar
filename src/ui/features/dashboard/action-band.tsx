import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Clock, RotateCcw } from "lucide-react";
import { Card } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { cn } from "@shared/utils";
import type { ActionBandCounts } from "@server/infrastructure/db/repositories/dashboard";

/**
 * Action band — the "what should I do right now?" surface, sitting above
 * the KPI strip. Each card answers a single question with a count + a
 * primary action.
 *
 * Tone semantics are bound to the design system (success/warning/destructive)
 * so theming flows from globals.css. Future state (V1.5+) cards use a
 * dashed-border treatment so they don't pretend to be live.
 */
export function ActionBand({ counts }: { counts: ActionBandCounts }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-stagger">
      <ActionCard
        icon={<AlertTriangle className="h-5 w-5" />}
        count={counts.noticeDeadlinesActionWindow}
        label="notice deadlines in the action window"
        href="/notice-deadlines"
        cta="Open calendar"
        tone={counts.noticeDeadlinesActionWindow > 0 ? "urgent" : "ok"}
      />
      <ActionCard
        icon={<Clock className="h-5 w-5" />}
        count={counts.renewalsAwaitingDecision}
        label="renewals awaiting your decision"
        href="/renewals"
        cta="Decide now"
        tone={counts.renewalsAwaitingDecision > 0 ? "moderate" : "ok"}
      />
      <ActionCard
        icon={<RotateCcw className="h-5 w-5" />}
        count={0}
        label="inactive seats past your threshold"
        href="#"
        cta="Coming soon"
        tone="future"
        disabled
      />
    </div>
  );
}

type ActionTone = "urgent" | "moderate" | "ok" | "future";

const toneCard: Record<ActionTone, string> = {
  urgent: "border-destructive/30 bg-destructive-soft/60",
  moderate: "border-warning/30 bg-warning-soft/60",
  ok: "border-success/25 bg-success-soft/50",
  future: "border-dashed border-border bg-muted/40",
};
const toneIcon: Record<ActionTone, string> = {
  urgent: "bg-destructive/10 text-destructive",
  moderate: "bg-warning/15 text-warning-soft-foreground",
  ok: "bg-success/15 text-success-soft-foreground",
  future: "bg-muted text-muted-foreground",
};
const toneNumber: Record<ActionTone, string> = {
  urgent: "text-destructive-soft-foreground",
  moderate: "text-warning-soft-foreground",
  ok: "text-success-soft-foreground",
  future: "text-muted-foreground",
};

function ActionCard({
  icon,
  count,
  label,
  href,
  cta,
  tone,
  disabled,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  href: string;
  cta: string;
  tone: ActionTone;
  disabled?: boolean;
}) {
  return (
    <Card className={cn("border p-5 flex flex-col gap-4", toneCard[tone])}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-md shrink-0 [&_svg]:h-4 [&_svg]:w-4",
            toneIcon[tone]
          )}
        >
          {tone === "ok" ? <Check /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          {tone === "ok" ? (
            <div className="text-sm font-medium text-success-soft-foreground">
              You're caught up
            </div>
          ) : (
            <div className="leading-tight">
              <div
                className={cn(
                  "font-display font-semibold text-3xl tabular-nums tracking-tight",
                  toneNumber[tone]
                )}
              >
                {count}
              </div>
              <div className="text-xs text-foreground/70 mt-1.5 leading-snug">
                {label}
              </div>
            </div>
          )}
        </div>
      </div>

      {tone === "ok" ? (
        <div className="text-[12px] text-success-soft-foreground/80">
          No {label}.
        </div>
      ) : disabled ? (
        <div className="text-xs text-muted-foreground italic">{cta}</div>
      ) : (
        <Button asChild variant="subtle" size="sm" className="w-full">
          <Link href={href}>
            {cta}
            <ArrowRight />
          </Link>
        </Button>
      )}
    </Card>
  );
}
