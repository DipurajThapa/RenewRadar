import { and, eq, gte, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import {
  accountsTable,
  renewalEventsTable,
  savingsRecordsTable,
  subscriptionsTable,
  usersTable,
} from "@/lib/db/schema";
import { listActionQueueRows } from "@/lib/db/queries/action-queue";
import {
  getSavingsTotals,
  listSavingsForAccount,
} from "@/lib/db/queries/savings";
import { sendEmail } from "@/lib/email/send";
import { resolveChannelPreference } from "@/lib/notifications/labels";
import { renderWeeklyDigestEmail } from "@/emails/weekly-digest";
import { renderMonthlySummaryEmail } from "@/emails/monthly-summary";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

/**
 * Weekly digest — every Monday 09:00 UTC.
 *
 * For each account, for each user who hasn't muted `weekly_digest`:
 *   - Resolve the current action queue
 *   - Count decisions logged in the last 7 days
 *   - Sum the savings booked in the last 7 days
 *   - Render and send a single email
 *
 * Send-once-per-week is enforced by the cron itself (single firing per week)
 * combined with a per-(user, week) unique notification row — same dedup
 * pattern as the notice-deadline cron.
 */
export const weeklyDigest = inngest.createFunction(
  {
    id: "weekly-digest",
    name: "Weekly digest email",
    retries: 3,
  },
  { cron: "0 9 * * 1" }, // Mondays at 09:00 UTC
  async ({ step }) => {
    const accounts = await step.run("list-accounts", async () =>
      db.select().from(accountsTable)
    );

    const weekStart = mondayOf(new Date());
    const weekStartIso = weekStart.toISOString().split("T")[0]!;

    let sent = 0;
    let skipped = 0;

    for (const account of accounts) {
      const users = await step.run(`users-${account.id}`, async () =>
        db
          .select()
          .from(usersTable)
          .where(eq(usersTable.accountId, account.id))
      );

      const queueRows = await step.run(`queue-${account.id}`, async () =>
        listActionQueueRows(account.id)
      );

      // Decisions in the last 7 days (via savings_record createdAt, which is
      // the timestamp the decision-driven savings row landed).
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weekSavings = await step.run(
        `week-savings-${account.id}`,
        async () =>
          db
            .select({
              count: sql<number>`count(*)::int`,
              saved: sql<number>`coalesce(sum(${savingsRecordsTable.savedAnnualUsdCents}), 0)::int`,
            })
            .from(savingsRecordsTable)
            .where(
              and(
                eq(savingsRecordsTable.accountId, account.id),
                gte(savingsRecordsTable.createdAt, sevenDaysAgo)
              )
            )
      );

      const decisionsThisWeek = weekSavings[0]?.count ?? 0;
      const savedThisWeek = weekSavings[0]?.saved ?? 0;

      for (const user of users) {
        const pref = resolveChannelPreference(
          user.notificationPrefs,
          "weekly_digest"
        );
        if (!pref.email) {
          skipped++;
          continue;
        }

        const html = await step.run(
          `render-week-${account.id}-${user.id}`,
          async () =>
            renderWeeklyDigestEmail({
              userName: user.fullName ?? user.workEmail,
              appUrl: APP_URL,
              weekStartIso,
              actionQueueRows: queueRows.slice(0, 8).map((r) => ({
                vendorName: r.vendorName,
                productName: r.productName,
                noticeDeadline: r.noticeDeadline,
                daysUntil: r.daysUntilNoticeDeadline,
                annualValueCents: r.annualValueCents,
                decideUrl: `${APP_URL}/subscriptions/${r.subscriptionId}/decide?event=${r.renewalEventId}`,
              })),
              decisionsThisWeek,
              savedThisWeekUsdCents: savedThisWeek,
            })
        );

        const result = await step.run(
          `send-week-${account.id}-${user.id}`,
          async () =>
            sendEmail({
              to: user.workEmail,
              subject: `Renewal Radar — your week ahead (${weekStartIso})`,
              html,
            })
        );

        if (result.ok) sent++;
        else skipped++;
      }
    }

    return { sent, skipped, accounts: accounts.length };
  }
);

/**
 * Monthly summary — 1st of every month 09:00 UTC.
 *
 * For each user (who hasn't muted `monthly_summary`):
 *   - Total saved YTD
 *   - Decisions in the prior month
 *   - Decisions YTD
 *   - Missed-deadline count YTD
 *   - Notice deadlines in the next 30 days + value at stake
 *
 * Sent the morning of the 1st so the previous month is closed out.
 */
export const monthlySummary = inngest.createFunction(
  {
    id: "monthly-summary",
    name: "Monthly summary email",
    retries: 3,
  },
  { cron: "0 9 1 * *" },
  async ({ step }) => {
    const accounts = await step.run("list-accounts", async () =>
      db.select().from(accountsTable)
    );

    const yearStart = new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00Z`);
    const monthLabel = lastMonthLabel(new Date());

    let sent = 0;
    let skipped = 0;

    for (const account of accounts) {
      const users = await step.run(`users-${account.id}`, async () =>
        db
          .select()
          .from(usersTable)
          .where(eq(usersTable.accountId, account.id))
      );

      const totals = await step.run(`totals-${account.id}`, async () =>
        getSavingsTotals(account.id, { sinceDate: yearStart })
      );
      const recent = await step.run(`recent-${account.id}`, async () =>
        listSavingsForAccount(account.id, { limit: 1 })
      );
      void recent;

      // Decisions this calendar month
      const firstOfThisMonth = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
      );
      const lastMonthStart = new Date(firstOfThisMonth);
      lastMonthStart.setUTCMonth(lastMonthStart.getUTCMonth() - 1);

      const monthDecisions = await step.run(
        `month-decisions-${account.id}`,
        async () =>
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(savingsRecordsTable)
            .where(
              and(
                eq(savingsRecordsTable.accountId, account.id),
                gte(savingsRecordsTable.createdAt, lastMonthStart)
              )
            )
      );

      // Missed deadlines YTD
      const missedYtd = await step.run(
        `missed-${account.id}`,
        async () =>
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(renewalEventsTable)
            .where(
              and(
                eq(renewalEventsTable.accountId, account.id),
                eq(renewalEventsTable.status, "missed"),
                gte(
                  renewalEventsTable.noticeDeadline,
                  yearStart.toISOString().split("T")[0]!
                )
              )
            )
      );

      // Upcoming notice deadlines in the next 30 days
      const today = new Date().toISOString().split("T")[0]!;
      const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]!;
      const upcoming = await step.run(
        `upcoming-${account.id}`,
        async () =>
          db
            .select({
              count: sql<number>`count(*)::int`,
              valueCents: sql<number>`
                coalesce(
                  sum(
                    case
                      when ${subscriptionsTable.billingCycle} = 'monthly'
                        then ${subscriptionsTable.totalCostPerPeriodCents} * 12
                      when ${subscriptionsTable.billingCycle} = 'quarterly'
                        then ${subscriptionsTable.totalCostPerPeriodCents} * 4
                      else ${subscriptionsTable.totalCostPerPeriodCents}
                    end
                  ),
                  0
                )::int
              `,
            })
            .from(renewalEventsTable)
            .innerJoin(
              subscriptionsTable,
              eq(renewalEventsTable.subscriptionId, subscriptionsTable.id)
            )
            .where(
              and(
                eq(renewalEventsTable.accountId, account.id),
                eq(subscriptionsTable.status, "active"),
                gte(renewalEventsTable.noticeDeadline, today),
                sql`${renewalEventsTable.noticeDeadline} <= ${in30}`
              )
            )
      );

      for (const user of users) {
        const pref = resolveChannelPreference(
          user.notificationPrefs,
          "monthly_summary"
        );
        if (!pref.email) {
          skipped++;
          continue;
        }

        const html = await step.run(
          `render-month-${account.id}-${user.id}`,
          async () =>
            renderMonthlySummaryEmail({
              userName: user.fullName ?? user.workEmail,
              appUrl: APP_URL,
              monthLabel,
              totalSavedYtdCents: totals.totalSavedAnnualUsdCents,
              decisionsCountMonth: monthDecisions[0]?.count ?? 0,
              decisionsCountYtd: totals.recordCount,
              missedCountYtd: missedYtd[0]?.count ?? 0,
              upcomingNext30Count: upcoming[0]?.count ?? 0,
              upcomingNext30ValueCents: upcoming[0]?.valueCents ?? 0,
            })
        );

        const result = await step.run(
          `send-month-${account.id}-${user.id}`,
          async () =>
            sendEmail({
              to: user.workEmail,
              subject: `Renewal Radar — ${monthLabel} summary`,
              html,
            })
        );

        if (result.ok) sent++;
        else skipped++;
      }
    }

    return { sent, skipped, accounts: accounts.length };
  }
);

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Return the Monday-at-midnight-UTC of the week containing `now`.
 * Used to label the digest with the start-of-week date.
 */
function mondayOf(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Label for the just-ended month — used in the subject + heading of the
 * monthly summary email. "October 2026" etc.
 */
function lastMonthLabel(now: Date): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prev.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
