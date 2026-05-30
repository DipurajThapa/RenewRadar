/**
 * AI1 — the autonomous Renewal Agent. The first genuinely proactive surface:
 * instead of waiting for a human to click "Generate brief" / "Draft notice",
 * this loop pre-preps every renewal as it enters its notice window.
 *
 * For each subscription whose renewal event is in notice_window / action_needed,
 * whose account hasn't switched the agent off (agentAutoPrep), and which hasn't
 * been prepped yet, it auto-generates the Renewal Intelligence Brief and the
 * internal notice draft with a SYSTEM actor (null) — so the work carries honest
 * "system" provenance in the audit log + vendor timeline.
 *
 * Safe by construction: every action is INTERNAL and REVERSIBLE (a brief and an
 * internal memo — never a vendor contact, never money), and idempotent (it skips
 * anything already prepped). Advisory-externally is preserved: a human still
 * reviews, decides, and sends. Runs at 07:30 UTC, just after the renewal-event
 * state machine (07:00) advances statuses.
 */
import { inngest } from "@server/jobs/client";
import { listSubscriptionsNeedingAutoPrep } from "@server/infrastructure/db/repositories/renewals";
import { generateAndStoreBrief } from "@server/application/renewal-brief";
import { generateAndStoreNoticeDraft } from "@server/application/renewal-notice";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "jobs.renewal-agent" });

export type RenewalAgentResult = {
  candidates: number;
  prepped: number;
  failed: number;
};

type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

/** Core loop, extracted for unit testing (mirrors runSpendSync). */
export async function runRenewalAgent(
  runStep: StepRunner
): Promise<RenewalAgentResult> {
  const candidates = await listSubscriptionsNeedingAutoPrep();
  let prepped = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await runStep(`prep-${c.subscriptionId}`, async () => {
        // SYSTEM actor (null): internal + reversible + audited. Brief first,
        // then the notice (which deterministically composes from that brief).
        await generateAndStoreBrief({
          accountId: c.accountId,
          subscriptionId: c.subscriptionId,
          actorUserId: null,
        });
        await generateAndStoreNoticeDraft({
          accountId: c.accountId,
          subscriptionId: c.subscriptionId,
          actorUserId: null,
        });
        return null;
      });
      prepped++;
    } catch (err) {
      // One subscription failing must not stop the batch.
      failed++;
      log.error("auto-prep failed", err, { subscriptionId: c.subscriptionId });
    }
  }
  log.info("renewal agent run", {
    candidates: candidates.length,
    prepped,
    failed,
  });
  return { candidates: candidates.length, prepped, failed };
}

export const renewalAgent = inngest.createFunction(
  { id: "renewal-agent", name: "Autonomous renewal agent — proactive auto-prep", retries: 1 },
  { cron: "30 7 * * *" },
  async ({ step }) =>
    runRenewalAgent(<T>(id: string, fn: () => Promise<T>) =>
      step.run(id, fn) as Promise<T>
    )
);
