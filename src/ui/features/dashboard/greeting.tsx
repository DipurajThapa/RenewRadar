import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency, pluralize } from "@shared/utils";

/**
 * Dashboard greeting — the top-of-page header for the live dashboard
 * (i.e. once the account has at least one tracked subscription).
 *
 * Visual hierarchy:
 *   1. Greeting + name              (display type, primary)
 *   2. Action chip                  (only when something needs attention)
 *   3. Subtle date + activity line  (smaller, muted)
 *   4. Quick CTA: open action queue
 *
 * When `provenSavedYtdAnnualUsdCents > 0`, we render a "Saved YTD" pill next to
 * the greeting — PROVEN (reconciled) savings only, so the headline pill never
 * advertises an unreconciled projection as money saved.
 */
export function DashboardGreeting({
  firstName,
  noticeNext30,
  renewalsAwaiting,
  provenSavedYtdAnnualUsdCents,
}: {
  firstName: string;
  noticeNext30: number;
  renewalsAwaiting: number;
  provenSavedYtdAnnualUsdCents: number;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              {greeting}, {firstName}.
            </h1>
            {provenSavedYtdAnnualUsdCents > 0 && (
              <Badge
                variant="success-soft"
                className="text-[12px] px-3 py-1 gap-2 font-semibold"
              >
                <Sparkles className="h-3 w-3" />
                <span>
                  Saved YTD{" "}
                  <span className="tabular-nums font-bold">
                    {formatCurrency(provenSavedYtdAnnualUsdCents)}
                  </span>
                </span>
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground/70">{today}</span> ·{" "}
            <strong className="text-foreground/80 font-medium">
              {pluralize(noticeNext30, "notice deadline")}
            </strong>{" "}
            in the next 30 days ·{" "}
            <strong className="text-foreground/80 font-medium">
              {pluralize(renewalsAwaiting, "renewal")}
            </strong>{" "}
            awaiting a decision
          </p>
        </div>

        {(noticeNext30 > 0 || renewalsAwaiting > 0) && (
          <Button asChild variant="default" className="shrink-0">
            <Link href="/action-queue">
              Open action queue
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
