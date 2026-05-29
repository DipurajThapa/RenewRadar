/**
 * Daily cron — enforce the past-due grace ceiling.
 *
 * Pre-fix: Stripe's `past_due` status held the account on its paid tier
 * indefinitely. Combined with the previous Stripe trust holes (REV-2/3),
 * an unpaid customer could ride Pro for months with no automatic cleanup
 * (audit H3).
 *
 * Post-fix: this cron runs every day at 02:00 UTC, scans accounts whose
 * `pastDueSince` is older than PAST_DUE_GRACE_DAYS, and force-downgrades
 * them to free_forever. The webhook is responsible for setting
 * `pastDueSince` (on past_due) and clearing it (on active/trialing).
 *
 * The cron is the time-based half of the guarantee — it runs even if
 * Stripe never fires another webhook on the affected subscription, which
 * is the worst-case scenario we have to defend against.
 */
import { and, eq, isNotNull, lt, not } from "drizzle-orm";
import { inngest } from "@server/jobs/client";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import { PAST_DUE_GRACE_DAYS } from "@server/infrastructure/billing/webhook";

export const pastDueGraceEnforcement = inngest.createFunction(
  {
    id: "past-due-grace-enforcement",
    name: "Downgrade past-due accounts after grace window",
    retries: 3,
  },
  { cron: "0 2 * * *" }, // 02:00 UTC daily
  async () => {
    const result = await runPastDueGraceEnforcement(new Date());
    return result;
  }
);

/**
 * Pure-DB implementation, callable directly by tests. Returns the list of
 * downgraded account IDs so the caller (or a test) can assert.
 */
export async function runPastDueGraceEnforcement(now: Date): Promise<{
  downgraded: string[];
}> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - PAST_DUE_GRACE_DAYS);

  const downgraded = await db
    .update(accountsTable)
    .set({
      planTier: "free_forever",
      // Clear the grace marker — once enforced, future past_due cycles
      // (after they pay + lapse again) start fresh.
      pastDueSince: null,
    })
    .where(
      and(
        isNotNull(accountsTable.pastDueSince),
        lt(accountsTable.pastDueSince, cutoff),
        // Already on free_forever? Nothing to do.
        not(eq(accountsTable.planTier, "free_forever"))
      )
    )
    .returning({ id: accountsTable.id });

  return { downgraded: downgraded.map((d) => d.id) };
}
