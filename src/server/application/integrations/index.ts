import { and, eq, isNull } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { integrationsTable } from "@server/infrastructure/db/schema";
import type { IntegrationKind } from "@server/infrastructure/db/schema";
import {
  decryptJson,
  encryptJson,
} from "@server/infrastructure/crypto/envelope";
import {
  computeIcsTokenLookupHash,
  type IcsConfig,
} from "@server/infrastructure/db/repositories/integrations";
import { AUDIT_ACTIONS, writeAuditLog } from "@server/infrastructure/audit-log/writer";

/**
 * Derive the public-lookup hash for an integration config — only meaningful
 * for kinds with a public unauth route (currently `ics_export`). Returns
 * null for kinds with no public lookup (e.g. slack_webhook).
 */
function deriveTokenLookupHash(
  kind: IntegrationKind,
  config: unknown
): string | null {
  if (kind === "ics_export") {
    const c = config as IcsConfig | undefined;
    if (c?.token) return computeIcsTokenLookupHash(c.token);
  }
  return null;
}

/**
 * Upsert an integration's config. Encrypts the config blob with the account's
 * derived key before writing. Writes an audit log entry on every change.
 *
 * For ICS integrations, also computes and persists a SHA-256 of the token so
 * the `/api/calendar/[token].ics` lookup can use an indexed query instead of
 * scanning every account's row (the prior DoS vector — see
 * `findAccountByIcsToken`).
 */
export async function upsertIntegration(input: {
  accountId: string;
  actorUserId: string;
  kind: IntegrationKind;
  config: unknown;
  enabled?: boolean;
}): Promise<void> {
  const ciphertext = encryptJson(input.accountId, input.config);
  const tokenLookupHash = deriveTokenLookupHash(input.kind, input.config);

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
          tokenLookupHash,
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
          tokenLookupHash,
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

/**
 * Backfill `tokenLookupHash` for any pre-existing ICS integration rows.
 *
 * The hash column was added in migration 0008 with a NULL default. The hash
 * value can't be computed from the ciphertext alone — we have to decrypt
 * each row and re-hash. We do this once at boot (idempotent: subsequent
 * runs find nothing to backfill and exit fast).
 *
 * Called from `instrumentation.ts` so it runs on Next.js cold start.
 */
export async function backfillIcsTokenLookupHashes(): Promise<{
  scanned: number;
  updated: number;
}> {
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.kind, "ics_export"),
        isNull(integrationsTable.tokenLookupHash)
      )
    );

  let updated = 0;
  for (const row of rows) {
    try {
      const config = decryptJson<IcsConfig>(row.accountId, row.configCiphertext);
      if (!config.token) continue;
      const hash = computeIcsTokenLookupHash(config.token);
      await db
        .update(integrationsTable)
        .set({ tokenLookupHash: hash })
        .where(eq(integrationsTable.id, row.id));
      updated++;
    } catch (err) {
      console.error(
        `[backfillIcsTokenLookupHashes] row ${row.id} decrypt failed:`,
        err
      );
    }
  }
  return { scanned: rows.length, updated };
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
