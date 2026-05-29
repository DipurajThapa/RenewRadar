/**
 * Wedge PoC — idempotent spend sync.
 *
 * Pulls transactions from the connection's connector and lands them in
 * spend_transaction, deduped on (connectionId, externalId). Normalization
 * happens HERE (canonical spendMerchantKey) so the detector groups on a stable
 * field. The cursor advance + row inserts share ONE transaction so a partial
 * failure never leaves a gap (cursor advanced, rows missing) or duplicates
 * (rows in, cursor not advanced).
 *
 * AUDIT-EXEMPT: this writes the RAW spend table (no business-critical row
 * changes). The audited moment is the human confirm step in reconcile.ts.
 * Uses tx.* deliberately (atomicity), not db.* — see APPLICATION_EXEMPT.
 */
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  spendConnectionsTable,
  spendTransactionsTable,
  type SpendConnection,
} from "@server/infrastructure/db/schema";
import { getSpendConnector } from "@server/infrastructure/spend";
import { spendMerchantKey } from "@server/domain/spend/normalize";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "spend.ingest" });

export type IngestResult = { ingested: number; nextCursor: string | null };

export async function ingestSpendConnection(
  connection: SpendConnection
): Promise<IngestResult> {
  const connector = getSpendConnector({
    accountId: connection.accountId,
    kind: connection.kind,
    configCiphertext: connection.configCiphertext,
  });

  let result: Awaited<ReturnType<typeof connector.fetchTransactions>>;
  try {
    result = await connector.fetchTransactions({ cursor: connection.syncCursor });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(spendConnectionsTable)
      .set({ status: "error", lastSyncError: message, updatedAt: new Date() })
      .where(eq(spendConnectionsTable.id, connection.id));
    log.warn("spend sync fetch failed", { connectionId: connection.id, message });
    return { ingested: 0, nextCursor: connection.syncCursor };
  }

  if (result.transactions.length === 0) {
    await db
      .update(spendConnectionsTable)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(spendConnectionsTable.id, connection.id));
    return { ingested: 0, nextCursor: connection.syncCursor };
  }

  const rows = result.transactions.map((t) => ({
    accountId: connection.accountId,
    connectionId: connection.id,
    externalId: t.externalId,
    rawMerchant: t.rawMerchant,
    normalizedMerchant: spendMerchantKey(t.rawMerchant),
    mcc: t.mcc,
    amountCents: t.amountCents,
    currency: t.currency,
    chargedOn: t.chargedOn,
    cardLabel: t.cardLabel,
    status: "ingested" as const,
    rawPayloadJson: t.raw,
  }));

  let ingested = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const inserted = await tx
        .insert(spendTransactionsTable)
        .values(row)
        .onConflictDoNothing({
          target: [
            spendTransactionsTable.connectionId,
            spendTransactionsTable.externalId,
          ],
        })
        .returning({ id: spendTransactionsTable.id });
      if (inserted.length > 0) ingested += 1;
    }
    await tx
      .update(spendConnectionsTable)
      .set({
        syncCursor: result.nextCursor,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(spendConnectionsTable.id, connection.id));
  });

  log.info("spend sync ingested", {
    connectionId: connection.id,
    ingested,
    seen: rows.length,
  });
  return { ingested, nextCursor: result.nextCursor };
}
