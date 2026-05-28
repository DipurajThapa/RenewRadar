import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { integrationsTable } from "@server/infrastructure/db/schema";
import type { Integration, IntegrationKind } from "@server/infrastructure/db/schema";
import { decryptJson } from "@server/infrastructure/crypto/envelope";

export type SlackConfig = { webhookUrl: string };
export type IcsConfig = { token: string };

export type IntegrationView<T> = {
  id: string;
  kind: IntegrationKind;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  config: T;
};

async function loadByKind(
  accountId: string,
  kind: IntegrationKind
): Promise<Integration | null> {
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.accountId, accountId),
        eq(integrationsTable.kind, kind)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getSlackIntegration(
  accountId: string
): Promise<IntegrationView<SlackConfig> | null> {
  const row = await loadByKind(accountId, "slack_webhook");
  if (!row) return null;
  try {
    const config = decryptJson<SlackConfig>(accountId, row.configCiphertext);
    return {
      id: row.id,
      kind: row.kind,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      config,
    };
  } catch (err) {
    console.error("[getSlackIntegration] decrypt failed:", err);
    return null;
  }
}

export async function getIcsIntegration(
  accountId: string
): Promise<IntegrationView<IcsConfig> | null> {
  const row = await loadByKind(accountId, "ics_export");
  if (!row) return null;
  try {
    const config = decryptJson<IcsConfig>(accountId, row.configCiphertext);
    return {
      id: row.id,
      kind: row.kind,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      config,
    };
  } catch (err) {
    console.error("[getIcsIntegration] decrypt failed:", err);
    return null;
  }
}

/**
 * Look up the (accountId, token) pair for an ICS export request. Used by the
 * `/api/calendar/[token].ics` route handler — no auth required, just a valid
 * unguessable token.
 *
 * To keep the lookup O(N over accounts) we'd want a separate index, but in
 * V1 there are very few integrations per account and the table is small.
 * If this becomes a hotspot we hash the token and index the hash.
 */
export async function findAccountByIcsToken(
  token: string
): Promise<{ accountId: string } | null> {
  // Constant-time-ish enumeration — small N, but worth flagging for revisit.
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.kind, "ics_export"));
  for (const row of rows) {
    try {
      const config = decryptJson<IcsConfig>(row.accountId, row.configCiphertext);
      if (config.token === token) {
        return { accountId: row.accountId };
      }
    } catch {
      // Skip rows that fail to decrypt (likely a key rotation in flight).
    }
  }
  return null;
}
