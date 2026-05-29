/**
 * Public API key lifecycle (T4.6).
 *
 * Invariants:
 *   1. The raw key value is returned EXACTLY ONCE — at creation time. We
 *      store only `SHA-256(raw)` and a short prefix for lookup.
 *   2. Verification is constant-time-equal on the hash so a partial match
 *      can't be probed via timing. (`crypto.timingSafeEqual`.)
 *   3. A revoked key fails verification immediately — `revokedAt IS NULL`
 *      is part of the SQL filter, so a leaked key can be killed instantly
 *      without restarting any process.
 *   4. Verification touches `lastUsedAt` so the dashboard can show staleness.
 *      Done as a fire-and-forget update so the API hot path stays one SELECT.
 *   5. Scopes are validated at creation against `API_KEY_SCOPES`. The
 *      verifyApiKey path returns the scope list verbatim; route handlers
 *      check `hasScope(key, "subscriptions:write")` etc.
 */
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  apiKeysTable,
  type ApiKey,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";

/**
 * Closed enum of permission scopes. Adding a new scope requires no
 * migration — the column is `text[]`. Adding to this list, however, is a
 * code change so a reviewer notices when surface area grows.
 */
export const API_KEY_SCOPES = [
  "subscriptions:read",
  "subscriptions:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

/**
 * Build a fresh key: `rr_pk_<32 hex>` (~38 chars total). The `rr_pk_`
 * literal prefix lets GitHub secret-scanning and gitleaks-style tools
 * recognize a leaked key by shape.
 */
export function generateRawKey(): { raw: string; prefix: string; hash: string } {
  const bytes = randomBytes(16); // 16 bytes → 32 hex chars
  const hex = bytes.toString("hex");
  const raw = `rr_pk_${hex}`;
  const prefix = hex.slice(0, 8);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, prefix, hash };
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time string compare via timingSafeEqual on Buffer pairs of equal
 * length. Wrapped so the verify path is one call site.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

export type CreateApiKeyInput = {
  accountId: string;
  createdByUserId: string;
  name: string;
  scopes: ApiKeyScope[];
};

export type CreateApiKeyResult = {
  /** The full raw key. Returned to the caller ONCE; never persisted. */
  rawKey: string;
  /** The stored row (no secret material). */
  row: ApiKey;
};

export async function createApiKey(
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  if (!input.name.trim() || input.name.trim().length > 80) {
    throw new ApiKeyError("Name is required (1–80 characters).");
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new ApiKeyError("At least one scope is required.");
  }
  for (const s of input.scopes) {
    if (!(API_KEY_SCOPES as readonly string[]).includes(s)) {
      throw new ApiKeyError(`Unknown scope: ${s}`);
    }
  }

  const { raw, prefix, hash } = generateRawKey();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiKeysTable)
      .values({
        accountId: input.accountId,
        name: input.name.trim(),
        keyPrefix: prefix,
        keyHash: hash,
        scopesJson: input.scopes,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (!row) throw new ApiKeyError("Failed to insert API key.");

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.createdByUserId,
      action: AUDIT_ACTIONS.apiKeyCreated,
      target: { entityType: "api_key", entityId: row.id },
      after: {
        name: row.name,
        scopes: input.scopes,
        keyPrefix: row.keyPrefix,
      },
    });

    return { rawKey: raw, row };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Revoke
// ─────────────────────────────────────────────────────────────────────────

export async function revokeApiKey(input: {
  accountId: string;
  apiKeyId: string;
  revokedByUserId: string;
}): Promise<ApiKey | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, input.apiKeyId))
      .limit(1);
    if (!row || row.accountId !== input.accountId) return null;
    if (row.revokedAt) return row; // idempotent

    const [updated] = await tx
      .update(apiKeysTable)
      .set({
        revokedAt: new Date(),
        revokedByUserId: input.revokedByUserId,
      })
      .where(eq(apiKeysTable.id, row.id))
      .returning();

    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: input.revokedByUserId,
      action: AUDIT_ACTIONS.apiKeyRevoked,
      target: { entityType: "api_key", entityId: row.id },
      after: { name: row.name, keyPrefix: row.keyPrefix },
    });

    return updated ?? null;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Verify (the API hot path)
// ─────────────────────────────────────────────────────────────────────────

export type VerifyApiKeyResult = {
  ok: true;
  apiKey: ApiKey;
} | { ok: false };

/**
 * Parse the raw key, look up the candidate row by prefix, and compare the
 * stored hash with a constant-time equality check. Returns ok:false for
 * any malformed/unknown/revoked input — the caller maps that to 401.
 */
export async function verifyApiKey(raw: string): Promise<VerifyApiKeyResult> {
  if (!raw || typeof raw !== "string") return { ok: false };
  if (!raw.startsWith("rr_pk_")) return { ok: false };
  const hex = raw.slice("rr_pk_".length);
  if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) return { ok: false };

  const prefix = hex.slice(0, 8);
  const candidates = await db
    .select()
    .from(apiKeysTable)
    .where(
      and(
        eq(apiKeysTable.keyPrefix, prefix),
        isNull(apiKeysTable.revokedAt)
      )
    );

  const expectedHash = hashKey(raw);
  for (const row of candidates) {
    if (safeEqual(row.keyHash, expectedHash)) {
      // Bump lastUsedAt without blocking the response — best-effort.
      void db
        .update(apiKeysTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeysTable.id, row.id))
        .catch(() => undefined);
      return { ok: true, apiKey: row };
    }
  }
  return { ok: false };
}

export function hasScope(key: ApiKey, scope: ApiKeyScope): boolean {
  return Array.isArray(key.scopesJson) && key.scopesJson.includes(scope);
}

// ─────────────────────────────────────────────────────────────────────────
// List (for the settings UI)
// ─────────────────────────────────────────────────────────────────────────

export async function listApiKeysForAccount(
  accountId: string
): Promise<ApiKey[]> {
  return db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.accountId, accountId));
}
