import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationsTable } from "@/lib/db/schema";
import type { IntegrationKind } from "@/lib/db/schema";
import { encryptJson } from "@/lib/crypto/envelope";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/write";

/**
 * Upsert an integration's config. Encrypts the config blob with the account's
 * derived key before writing. Writes an audit log entry on every change.
 */
export async function upsertIntegration(input: {
  accountId: string;
  actorUserId: string;
  kind: IntegrationKind;
  config: unknown;
  enabled?: boolean;
}): Promise<void> {
  const ciphertext = encryptJson(input.accountId, input.config);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(integrationsTable)
      .where(
        and(
          eq(integrationsTable.accountId, input.accountId),
          eq(integrationsTable.kind, input.kind)
        )
      )
      .limit(1);

    if (existing) {
      await tx
        .update(integrationsTable)
        .set({
          configCiphertext: ciphertext,
          enabled: input.enabled ?? existing.enabled,
        })
        .where(eq(integrationsTable.id, existing.id));

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.integrationConfigured,
        target: { entityType: "integration", entityId: existing.id },
        before: {
          kind: existing.kind,
          enabled: existing.enabled,
          updatedAt: existing.updatedAt,
        },
        after: {
          kind: input.kind,
          enabled: input.enabled ?? existing.enabled,
        },
      });
    } else {
      const [created] = await tx
        .insert(integrationsTable)
        .values({
          accountId: input.accountId,
          kind: input.kind,
          configCiphertext: ciphertext,
          enabled: input.enabled ?? true,
        })
        .returning();
      if (!created) throw new Error("Failed to insert integration");

      await writeAuditLog(tx, {
        accountId: input.accountId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.integrationConfigured,
        target: { entityType: "integration", entityId: created.id },
        after: { kind: input.kind, enabled: created.enabled },
      });
    }
  });
}

export async function disableIntegration(input: {
  accountId: string;
  actorUserId: string;
  kind: IntegrationKind;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(integrationsTable)
      .where(
        and(
          eq(integrationsTable.accountId, input.accountId),
          eq(integrationsTable.kind, input.kind)
        )
      )
      .limit(1);
    if (!existing) return;

    await tx
      .update(integrationsTable)
      .set({ enabled: false })
      .where(eq(integrationsTable.id, existing.id));

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.integrationDisabled,
      target: { entityType: "integration", entityId: existing.id },
      before: { enabled: existing.enabled },
      after: { enabled: false },
    });
  });
}
