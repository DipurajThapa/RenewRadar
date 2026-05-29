/**
 * A2 — daily savings reconciliation. For every savings record whose realization
 * date has passed and that isn't reconciled yet, compare the projected saving
 * against the actual post-renewal spend and mark it realized | variance (or
 * leave it pending if no post-renewal charge has been observed). Runs after the
 * spend-sync cron (0 6) so the latest charges are already ingested.
 *
 * Advisor, never agent: this only RECORDS what actually happened — it never
 * changes a price or contacts a vendor.
 */
import { inngest } from "@server/jobs/client";
import { listSavingsRecordsDueForReconciliation } from "@server/infrastructure/db/repositories/savings";
import { reconcileSavingsRecord } from "@server/application/savings/reconcile";

export type SavingsReconciliationResult = {
  due: number;
  realized: number;
  variance: number;
  notObserved: number;
};

type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

/** Core loop, extracted for unit testing (mirrors runSpendSync). `now` is
 *  injected so tests are deterministic. */
export async function runSavingsReconciliation(
  runStep: StepRunner,
  now: Date
): Promise<SavingsReconciliationResult> {
  const due = await listSavingsRecordsDueForReconciliation(now);
  let realized = 0;
  let variance = 0;
  let notObserved = 0;
  for (const record of due) {
    const res = await runStep(`reconcile-${record.id}`, async () =>
      reconcileSavingsRecord({
        accountId: record.accountId,
        savingsRecordId: record.id,
        now,
      })
    );
    if (res.status === "realized") realized++;
    else if (res.status === "variance") variance++;
    else notObserved++;
  }
  return { due: due.length, realized, variance, notObserved };
}

export const savingsReconciliation = inngest.createFunction(
  {
    id: "savings-reconciliation",
    name: "Daily projected→realized savings reconciliation",
    retries: 2,
  },
  { cron: "0 8 * * *" },
  async ({ step }) =>
    runSavingsReconciliation(
      <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
      new Date()
    )
);
