/**
 * Wedge PoC — daily spend sync. For every active spend_connection (all
 * accounts), ingest new transactions then run detection. DETECTION ONLY —
 * never auto-confirms a subscription (advisor, never agent). A fresh connector
 * is built per connection (no shared cross-account state).
 *
 * This is what makes "the human stops being the data pipe" true: the inventory
 * keeps populating itself on a schedule, forever.
 */
import { inngest } from "@server/jobs/client";
import { listAllActiveSpendConnectionsForCron } from "@server/infrastructure/db/repositories/spend";
import { ingestSpendConnection } from "@server/application/spend/ingest";
import { detectRecurringForConnection } from "@server/application/spend/detect";
import { hasTierFeature } from "@server/domain/billing/tier-features";

export type SpendSyncResult = {
  connections: number;
  skipped: number;
  ingested: number;
  detected: number;
};

/** Step runner abstraction: the Inngest function passes `step.run` (durable +
 *  retried); tests pass a pass-through so the loop is exercised directly. */
type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

/**
 * Core spend-sync loop, extracted so it's unit-testable without the Inngest
 * runtime (mirrors runAuditRetention). Ingests + detects for every active
 * connection whose plan still includes spend auto-discovery; skips the rest.
 */
export async function runSpendSync(runStep: StepRunner): Promise<SpendSyncResult> {
  // Fetched outside any step: a quick read, and step.run would JSON-serialize
  // the rows (Date → string) before they reach ingest, which wants the typed
  // SpendConnection. The per-connection ingest/detect ARE wrapped for retries.
  const connections = await listAllActiveSpendConnectionsForCron();

  let ingested = 0;
  let detected = 0;
  let skipped = 0;
  for (const connection of connections) {
    // Skip connections whose plan no longer includes spend auto-discovery
    // (e.g. a paid→free downgrade left the connection row active). Otherwise
    // the cron would keep ingesting + detecting for free (REV-5).
    if (!hasTierFeature(connection.planTier, "spendAutoDiscovery")) {
      skipped++;
      continue;
    }
    const ing = await runStep(`ingest-${connection.id}`, async () =>
      ingestSpendConnection(connection)
    );
    ingested += ing.ingested;
    const det = await runStep(`detect-${connection.id}`, async () =>
      detectRecurringForConnection({
        accountId: connection.accountId,
        connectionId: connection.id,
      })
    );
    detected += det.detected;
  }
  return { connections: connections.length, skipped, ingested, detected };
}

export const spendSync = inngest.createFunction(
  { id: "spend-sync", name: "Daily spend feed sync + detection", retries: 2 },
  { cron: "0 6 * * *" },
  // step.run returns Jsonify<T>; the only payloads here are plain
  // {ingested:number}/{detected:number}, which round-trip JSON unchanged, so
  // the localized cast is safe.
  async ({ step }) =>
    runSpendSync(<T>(id: string, fn: () => Promise<T>) =>
      step.run(id, fn) as Promise<T>
    )
);
