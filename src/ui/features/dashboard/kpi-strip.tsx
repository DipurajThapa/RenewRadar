import { CalendarClock, Coins, Database, TrendingUp } from "lucide-react";
import { StatCard } from "@ui/components/shared/stat-card";
import { formatCurrency } from "@shared/utils";
import type { DashboardKpis } from "@server/infrastructure/db/repositories/dashboard";

/**
 * KPI strip — four big numbers above the fold.
 *
 * Order is intentional:
 *   1. Saved this year   — answers "why am I paying for this?"
 *   2. Tracked subs       — answers "what's actually in here?"
 *   3. Annualized spend   — answers "how much is at stake?"
 *   4. Notice deadlines   — answers "what needs attention?"
 *
 * Stat #1 leads with PROVEN savings (reconciled against actual post-renewal
 * spend) and uses the `success` tone only when there's a proven figure — an
 * unreconciled projection is never dressed up as money already saved. The
 * rest are neutral so the page doesn't feel like a Christmas tree.
 */
export function KpiStrip({ kpis }: { kpis: DashboardKpis }) {
  const proven = kpis.provenSavedYtdAnnualUsdCents;
  const projected = kpis.savedYtdAnnualUsdCents;
  // Headline = proven when we have it; otherwise show the projection but label
  // it as such and drop the success tone (it isn't banked yet).
  const hasProven = proven > 0;
  const savedLabel = hasProven ? "Saved this year" : "Projected savings";
  const savedValue = formatCurrency(hasProven ? proven : projected);
  const savedSubLabel = hasProven
    ? projected > proven
      ? `Proven · ${formatCurrency(projected - proven)} more projected`
      : "Proven against actual spend"
    : projected > 0
      ? "Estimated — not yet reconciled"
      : "Log a decision to start counting";
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-stagger">
      <StatCard
        tone={hasProven ? "success" : "default"}
        label={savedLabel}
        value={savedValue}
        sublabel={savedSubLabel}
        icon={<Coins />}
      />
      <StatCard
        label="Tracked subscriptions"
        value={kpis.trackedSubscriptions.toString()}
        sublabel={
          kpis.trackedSubscriptionsAddedThisMonth > 0
            ? `${kpis.trackedSubscriptionsAddedThisMonth} added this month`
            : "No changes this month"
        }
        icon={<Database />}
        delta={
          kpis.trackedSubscriptionsAddedThisMonth > 0
            ? {
                value: `+${kpis.trackedSubscriptionsAddedThisMonth}`,
                trend: "up",
              }
            : undefined
        }
      />
      <StatCard
        label="Annualized spend"
        value={formatCurrency(kpis.totalAnnualSpendCents)}
        sublabel="Across active subscriptions"
        icon={<TrendingUp />}
      />
      <StatCard
        label="Notice deadlines · 30 d"
        value={kpis.noticeDeadlinesNext30Count.toString()}
        sublabel={
          kpis.noticeDeadlinesNext30Count > 0
            ? `${formatCurrency(kpis.noticeDeadlinesNext30ValueCents)} at stake`
            : "You're caught up"
        }
        icon={<CalendarClock />}
        tone={kpis.noticeDeadlinesNext30Count > 0 ? "primary" : "default"}
      />
    </div>
  );
}
