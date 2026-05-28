import Link from "next/link";
import { AlertTriangle, Clock, RotateCcw, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionBandCounts } from "@/lib/db/queries/dashboard";

export function ActionBand({ counts }: { counts: ActionBandCounts }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ActionCard
        icon={<AlertTriangle className="h-5 w-5" />}
        count={counts.noticeDeadlinesActionWindow}
        label="notice deadlines hit action window"
        href="/notice-deadlines"
        cta="View calendar"
        tone={counts.noticeDeadlinesActionWindow > 0 ? "urgent" : "ok"}
      />
      <ActionCard
        icon={<Clock className="h-5 w-5" />}
        count={counts.renewalsAwaitingDecision}
        label="renewals awaiting your decision"
        href="/renewals"
        cta="View calendar"
        tone={counts.renewalsAwaitingDecision > 0 ? "moderate" : "ok"}
      />
      <ActionCard
        icon={<RotateCcw className="h-5 w-5" />}
        count={0}
        label="seats inactive past threshold"
        href="#"
        cta="Coming in V1.5"
        tone="future"
        disabled
      />
    </div>
  );
}

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
  tone: "urgent" | "moderate" | "ok" | "future";
  disabled?: boolean;
}) {
  const toneClasses = {
    urgent: "border-red-300 bg-red-50",
    moderate: "border-yellow-300 bg-yellow-50",
    ok: "border-green-200 bg-green-50",
    future: "border-dashed border-gray-200 bg-muted/30 opacity-70",
  }[tone];

  return (
    <Card className={cn("border", toneClasses)}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-2">
          {tone === "ok" ? (
            <Check className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <span className="shrink-0">{icon}</span>
          )}
          <div className="text-sm">
            {tone === "ok" ? (
              <span>All clear — no {label}</span>
            ) : (
              <>
                <span className="text-2xl font-bold leading-none">{count}</span>{" "}
                <span className="text-muted-foreground">{label}</span>
              </>
            )}
          </div>
        </div>

        {tone === "ok" ? null : disabled ? (
          <div className="text-xs text-muted-foreground italic">{cta}</div>
        ) : (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={href}>{cta} →</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
