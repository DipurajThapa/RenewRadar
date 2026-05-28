import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  getActionBandCounts,
  getAnomalies,
  getDashboardKpis,
  getNoticeDeadlineSpotlight,
  getRecentActivity,
  getRenewalCalendarSnapshot,
} from "@server/infrastructure/db/repositories/dashboard";
import { DashboardGreeting } from "@ui/features/dashboard/greeting";
import { ActionBand } from "@ui/features/dashboard/action-band";
import { KpiStrip } from "@ui/features/dashboard/kpi-strip";
import { NoticeDeadlineSpotlight } from "@ui/features/dashboard/notice-deadline-spotlight";
import { RenewalCalendarSnapshot } from "@ui/features/dashboard/renewal-calendar-snapshot";
import { Anomalies } from "@ui/features/dashboard/anomalies";
import { RecentActivity } from "@ui/features/dashboard/recent-activity";
import { FreeForeverNudge } from "@ui/features/dashboard/free-forever-nudge";
import { EmptyDashboard } from "@ui/features/dashboard/empty-dashboard";
import { CoachMarkSequence } from "@ui/features/onboarding/coach-mark";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { account, user } = await getCurrentAccountAndUser();

  const [actions, kpis, spotlight, calendarSnapshot, anomalies, activity] =
    await Promise.all([
      getActionBandCounts(account.id),
      getDashboardKpis(account.id),
      getNoticeDeadlineSpotlight(account.id, 5),
      getRenewalCalendarSnapshot(account.id),
      getAnomalies(account.id),
      getRecentActivity(account.id, 8),
    ]);

  if (kpis.trackedSubscriptions === 0) {
    return (
      <EmptyDashboard
        userFirstName={user.fullName?.split(" ")[0] ?? "there"}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <DashboardGreeting
        firstName={user.fullName?.split(" ")[0] ?? "there"}
        noticeNext30={kpis.noticeDeadlinesNext30Count}
        renewalsAwaiting={actions.renewalsAwaitingDecision}
      />

      <ActionBand counts={actions} />

      {account.planTier === "free_forever" &&
        kpis.trackedSubscriptions >= 5 && <FreeForeverNudge />}

      <KpiStrip kpis={kpis} />

      {spotlight.length > 0 && (
        <NoticeDeadlineSpotlight
          rows={spotlight}
          totalCount={kpis.noticeDeadlinesNext30Count}
        />
      )}

      <RenewalCalendarSnapshot
        monthBuckets={calendarSnapshot.monthBuckets}
        topThree={calendarSnapshot.topThree}
      />

      <Anomalies anomalies={anomalies} />

      <RecentActivity entries={activity} />

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
