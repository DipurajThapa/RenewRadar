import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { inngest } from "@server/jobs/client";
import { db } from "@server/infrastructure/db/client";
import { renewalEventsTable } from "@server/infrastructure/db/schema";

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
 *   action_needed → missed         when notice_deadline has passed AND
 *                                  no decision has been logged
 *
 * Inngest wrapper around `runRenewalStateTransitions` — the latter is
 * exposed for unit testing under a controllable `today` so the boundary
 * conditions (deadline=today, deadline=today-1, decision!=null) can be
 * pinned without faking real time.
 */
export const renewalEventStateUpdate = inngest.createFunction(
  {
    id: "renewal-event-state-update",
    name: "Daily renewal event state transitions",
    retries: 3,
  },
  { cron: "0 7 * * *" },
  async ({ step }) => {
    const result = await step.run("apply-transitions", () =>
      runRenewalStateTransitions(new Date())
    );
    return result;
  }
);

/**
 * Pure-DB state-machine implementation, callable directly by tests.
 *
 * `today` is the date the cron is anchoring against. In production this is
 * `new Date()` at cron fire time; in tests we pass a controlled date so we
 * can pin boundary cases (yesterday / today / tomorrow) without faking
 * system time.
 */
export async function runRenewalStateTransitions(today: Date): Promise<{
  toNoticeWindow: number;
  toActionNeeded: number;
  toMissed: number;
}> {
  const todayStr = today.toISOString().split("T")[0]!;
  const in30 = addDays(todayStr, 30);
  const in7 = addDays(todayStr, 7);

  // Step order matters. We do notice_window → action_needed BEFORE
  // upcoming → notice_window so we can run both `lte(deadline, in30)` and
  // `lte(deadline, in7)` against disjoint state sets without an event
  // skipping a hop in a single run. Run order is upcoming first, then
  // notice_window, then action_needed.

  const toNoticeWindow = await db
    .update(renewalEventsTable)
    .set({ status: "notice_window" })
    .where(
      and(
        eq(renewalEventsTable.status, "upcoming"),
        lte(renewalEventsTable.noticeDeadline, in30)
      )
    )
    .returning({ id: renewalEventsTable.id });

  const toActionNeeded = await db
    .update(renewalEventsTable)
    .set({ status: "action_needed" })
    .where(
      and(
        eq(renewalEventsTable.status, "notice_window"),
        lte(renewalEventsTable.noticeDeadline, in7)
      )
    )
    .returning({ id: renewalEventsTable.id });

  const toMissed = await db
    .update(renewalEventsTable)
    .set({ status: "missed" })
    .where(
      and(
        eq(renewalEventsTable.status, "action_needed"),
        sql`${renewalEventsTable.noticeDeadline} < ${todayStr}`,
        isNull(renewalEventsTable.decision)
      )
    )
    .returning({ id: renewalEventsTable.id });

  return {
    toNoticeWindow: toNoticeWindow.length,
    toActionNeeded: toActionNeeded.length,
    toMissed: toMissed.length,
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0]!;
}
