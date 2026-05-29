import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getActionBandCounts,
  getAnomalies,
  getDashboardKpis,
  getNoticeDeadlineSpotlight,
  getRecentActivity,
  getRenewalCalendarSnapshot,
} from "@server/infrastructure/db/repositories/dashboard";
import { buildDashboardBenchmarkRows } from "@server/application/dashboard-benchmarks";
import { DashboardBenchmarkBand } from "@ui/features/dashboard/benchmark-band";
import { DashboardGreeting } from "@ui/features/dashboard/greeting";
import { ActionBand } from "@ui/features/dashboard/action-band";
import { KpiStrip } from "@ui/features/dashboard/kpi-strip";
import { NoticeDeadlineSpotlight } from "@ui/features/dashboard/notice-deadline-spotlight";
import { RenewalCalendarSnapshot } from "@ui/features/dashboard/renewal-calendar-snapshot";
import { Anomalies } from "@ui/features/dashboard/anomalies";
import { RecentActivity } from "@ui/features/dashboard/recent-activity";
import { FreeForeverNudge } from "@ui/features/dashboard/free-forever-nudge";
import { OnboardingHero } from "@ui/features/onboarding/onboarding-hero";
import { CoachMarkSequence } from "@ui/features/onboarding/coach-mark";

/**
 * Tiny section header used only inside the dashboard. Pulls the title + a
 * subtle subtitle so each section reads as its own beat, but uses display
 * type rather than headings so it doesn't compete with the page title.
 */
function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h2>
      {description && (
        <p className="text-sm text-muted-foreground/80">{description}</p>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { account, user } = await getCurrentAccountAndUser();

  const [
    actions,
    kpis,
    spotlight,
    calendarSnapshot,
    anomalies,
    activity,
    benchmarkRows,
  ] = await Promise.all([
    getActionBandCounts(account.id),
    getDashboardKpis(account.id),
    getNoticeDeadlineSpotlight(account.id, 5),
    getRenewalCalendarSnapshot(account.id),
    getAnomalies(account.id),
    getRecentActivity(account.id, 8),
    buildDashboardBenchmarkRows(account.id).catch(() => []),
  ]);

  if (kpis.trackedSubscriptions === 0) {
    // Upload-first onboarding: contract upload is the single highest-correlated
    // event with activation, so we make it the centerpiece. Manual entry +
    // CSV import are still one click away.
    return (
      <OnboardingHero
        userFirstName={user.fullName?.split(" ")[0] ?? "there"}
      />
    );
  }

  return (
    <div className="space-y-10">
      <DashboardGreeting
        firstName={user.fullName?.split(" ")[0] ?? "there"}
        noticeNext30={kpis.noticeDeadlinesNext30Count}
        renewalsAwaiting={actions.renewalsAwaitingDecision}
        savedYtdAnnualUsdCents={kpis.savedYtdAnnualUsdCents}
      />

      {/* Above-the-fold answer to "how am I doing?" */}
      <section className="space-y-4">
        <KpiStrip kpis={kpis} />
      </section>

      {/* Network-effects moat surfaced: anonymized peer benchmarks for the
          account's top vendors. Hidden when the cross-account sample size
          isn't there yet — most early-stage accounts. */}
      {benchmarkRows.length > 0 && (
        <section className="space-y-4">
          <DashboardBenchmarkBand rows={benchmarkRows} />
        </section>
      )}

      {/* What needs action right now */}
      <section className="space-y-4">
        <SectionHeader
          title="Action queue"
          description="Counts of what's open at this moment."
        />
        <ActionBand counts={actions} />
      </section>

      {account.planTier === "free_forever" &&
        kpis.trackedSubscriptions >= 5 && <FreeForeverNudge />}

      {spotlight.length > 0 && (
        <section className="space-y-4">
          <NoticeDeadlineSpotlight
            rows={spotlight}
            totalCount={kpis.noticeDeadlinesNext30Count}
          />
        </section>
      )}

      <section className="space-y-4">
        <RenewalCalendarSnapshot
          monthBuckets={calendarSnapshot.monthBuckets}
          topThree={calendarSnapshot.topThree}
        />
      </section>

      {/* Two-column on wide screens so the page doesn't tower vertically. */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Anomalies anomalies={anomalies} />
        <RecentActivity entries={activity} />
      </section>

      <CoachMarkSequence
        storageKey="dashboard-tour-v1"
        steps={[
          {
            title: "Welcome to Renewal Radar",
            body: "This dashboard shows what needs your attention today — notice deadlines, renewals, and anomalies.",
          },
          {
            title: "Action band at the top",
            body: "These cards count what you should act on right now. Green = caught up, red/yellow = action needed.",
          },
          {
            title: "Notice Deadline Spotlight",
            body: "The most urgent deadlines are one click from a decision. Try clicking one — it opens the Decide Now workflow.",
            action: { href: "/notice-deadlines", label: "Open calendar" },
          },
          {
            title: "Settings are in the top-right menu",
            body: "Update your account, notification preferences, and billing from there. You're all set — welcome aboard.",
          },
        ]}
      />
    </div>
  );
}
