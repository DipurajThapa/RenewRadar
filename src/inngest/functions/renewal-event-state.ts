import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { renewalEventsTable } from "@/lib/db/schema";

/**
 * Daily cron at 07:00 UTC — one hour before the alert cron.
 *
 * Progresses renewal events through their state machine based on the current
 * date. Idempotent: running it multiple times the same day yields the same
 * result.
 *
 * Transitions:
 *   upcoming      → notice_window  when notice_deadline is within 30 days
 *   notice_window → action_needed  when notice_deadline is within 7 days
 *   action_needed → missed         when notice_deadline has passed and
 *                                  no decision has been logged
 */
export const renewalEventStateUpdate = inngest.createFunction(
  {
    id: "renewal-event-state-update",
    name: "Daily renewal event state transitions",
    retries: 3,
  },
  { cron: "0 7 * * *" },
  async ({ step }) => {
    const today = new Date().toISOString().split("T")[0]!;
    const in30 = addDays(today, 30);
    const in7 = addDays(today, 7);

    const toNoticeWindow = await step.run("upcoming-to-notice-window", () =>
      db
        .update(renewalEventsTable)
        .set({ status: "notice_window" })
        .where(
          and(
            eq(renewalEventsTable.status, "upcoming"),
            lte(renewalEventsTable.noticeDeadline, in30)
          )
        )
        .returning({ id: renewalEventsTable.id })
    );

    const toActionNeeded = await step.run("notice-window-to-action-needed", () =>
      db
        .update(renewalEventsTable)
        .set({ status: "action_needed" })
        .where(
          and(
            eq(renewalEventsTable.status, "notice_window"),
            lte(renewalEventsTable.noticeDeadline, in7)
          )
        )
        .returning({ id: renewalEventsTable.id })
    );

    const toMissed = await step.run("action-needed-to-missed", () =>
      db
        .update(renewalEventsTable)
        .set({ status: "missed" })
        .where(
          and(
            eq(renewalEventsTable.status, "action_needed"),
            sql`${renewalEventsTable.noticeDeadline} < ${today}`,
            isNull(renewalEventsTable.decision)
          )
        )
        .returning({ id: renewalEventsTable.id })
    );

    return {
      toNoticeWindow: toNoticeWindow.length,
      toActionNeeded: toActionNeeded.length,
      toMissed: toMissed.length,
    };
  }
);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}
