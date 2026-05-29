/**
 * Wedge PoC — spend connection lifecycle (clone of upsertIntegration). Config
 * is envelope-encrypted; every mutation is audited in the same transaction.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  spendConnectionsTable,
  type SpendConnection,
} from "@server/infrastructure/db/schema";
import { encryptJson } from "@server/infrastructure/crypto/envelope";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

export async function upsertSpendConnection(input: {
  accountId: string;
  actorUserId: string;
  kind: "fixture" | "ramp";
  config: Record<string, unknown>;
}): Promise<SpendConnection> {
  const ciphertext = encryptJson(input.accountId, input.config);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(spendConnectionsTable)
      .values({
        accountId: input.accountId,
        kind: input.kind,
        configCiphertext: ciphertext,
        status: "active",
        createdByUserId: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: [spendConnectionsTable.accountId, spendConnectionsTable.kind],
        set: {
          configCiphertext: ciphertext,
          status: "active",
          lastSyncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("Failed to upsert spend connection");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.spendConnectionConfigured,
      target: { entityType: "spend_connection", entityId: row.id },
      after: { kind: row.kind, status: row.status },
    });
    return row;
  });
}

export async function disconnectSpendConnection(input: {
  accountId: string;
  actorUserId: string;
  kind: "fixture" | "ramp";
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(spendConnectionsTable)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(
        and(
          eq(spendConnectionsTable.accountId, input.accountId),
          eq(spendConnectionsTable.kind, input.kind)
        )
      )
      .returning();
    if (!row) return;
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.spendConnectionDisconnected,
      target: { entityType: "spend_connection", entityId: row.id },
      after: { kind: row.kind },
    });
  });
}
