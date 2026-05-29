import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
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
 * Stable SHA-256 of an ICS token. Used as an indexed lookup key so a single
 * row decryption (with scrypt key derivation) doesn't have to happen for
 * every row in the table on each public calendar request. SHA-256 has no
 * collisions worth defending against, so a single row match is conclusive.
 *
 * Exported so the upsert path can compute and persist the same hash.
 */
export function computeIcsTokenLookupHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Look up the (accountId, token) pair for an ICS export request. Used by the
 * `/api/calendar/[token].ics` route handler — no auth required, just a valid
 * unguessable token.
 *
 * Pre-fix: this scanned every account row and ran `scryptSync` per row to
 * decrypt, then compared in-cipher tokens. With N accounts, that was O(N)
 * CPU-intensive work per request — a CPU-exhaustion DoS surface for any
 * unauthenticated attacker hitting the route with garbage tokens.
 *
 * Post-fix: we look up by indexed `token_lookup_hash` (single row), then
 * decrypt only that candidate to verify the in-cipher token matches. The
 * lookup is O(1) regardless of account count.
 *
 * Disabled integrations are filtered out — `disableIcsExportAction` flips
 * `enabled=false`; without this filter the feed kept serving until the
 * token was also rotated (audit M3).
 */
export async function findAccountByIcsToken(
  token: string
): Promise<{ accountId: string } | null> {
  if (!token) return null;
  const hash = computeIcsTokenLookupHash(token);

  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.kind, "ics_export"),
        eq(integrationsTable.tokenLookupHash, hash),
        eq(integrationsTable.enabled, true)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Verify the in-cipher token matches the lookup hash. SHA-256 collisions
  // aren't a real concern, but pinning the in-cipher value guards against
  // a future schema bug where the hash and ciphertext drift out of sync.
  try {
    const config = decryptJson<IcsConfig>(row.accountId, row.configCiphertext);
    if (config.token !== token) {
      console.warn(
        "[findAccountByIcsToken] hash matched but in-cipher token differed; ignoring"
      );
      return null;
    }
  } catch (err) {
    console.error("[findAccountByIcsToken] decrypt failed:", err);
    return null;
  }

  return { accountId: row.accountId };
}
