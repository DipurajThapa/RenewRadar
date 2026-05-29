/**
 * T4.6 — API key lifecycle contract tests.
 *
 * The whole public API surface depends on these invariants:
 *   - The raw key is returned at creation and NEVER reconstructable from
 *     the stored row (hash + prefix only)
 *   - verifyApiKey ok:true for the exact key, ok:false for anything else
 *     (wrong key, malformed, revoked, expired prefix)
 *   - revokeApiKey is idempotent + scoped to the account that owns the key
 *   - scopes gate access — hasScope says yes only for granted scopes
 *   - Audit log records creation + revocation
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  apiKeysTable,
  auditLogTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  ApiKeyError,
  createApiKey,
  hasScope,
  listApiKeysForAccount,
  revokeApiKey,
  verifyApiKey,
} from "@server/application/api-keys";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

// ─────────────────────────────────────────────────────────────────────────
// createApiKey
// ─────────────────────────────────────────────────────────────────────────

describe("createApiKey", () => {
  it("returns the full raw key once + persists only the hash and prefix", async () => {
    const result = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Production backend",
      scopes: ["subscriptions:read", "subscriptions:write"],
    });
    expect(result.rawKey).toMatch(/^rr_pk_[a-f0-9]{32}$/);
    expect(result.row.keyPrefix).toBe(result.rawKey.slice(6, 14));
    expect(result.row.keyHash).not.toContain(result.rawKey);
    expect(result.row.keyHash.length).toBe(64); // SHA-256 hex

    // The raw key is NOT in any column of the stored row.
    const json = JSON.stringify(result.row);
    expect(json).not.toContain(result.rawKey);
  });

  it("writes an api_key.created audit entry", async () => {
    const result = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Audit test",
      scopes: ["subscriptions:read"],
    });
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "api_key.created"));
    expect(audits.length).toBe(1);
    const after = audits[0]?.after as Record<string, unknown>;
    expect(after.name).toBe("Audit test");
    expect(after.keyPrefix).toBe(result.row.keyPrefix);
  });

  it("rejects an unknown scope", async () => {
    await expect(
      createApiKey({
        accountId: ids.accountA.id,
        createdByUserId: ids.accountA.userId,
        name: "Bad scope",
        scopes: ["subscriptions:read", "made_up:scope"] as never,
      })
    ).rejects.toBeInstanceOf(ApiKeyError);
  });

  it("rejects empty name and empty scopes", async () => {
    await expect(
      createApiKey({
        accountId: ids.accountA.id,
        createdByUserId: ids.accountA.userId,
        name: "",
        scopes: ["subscriptions:read"],
      })
    ).rejects.toBeInstanceOf(ApiKeyError);
    await expect(
      createApiKey({
        accountId: ids.accountA.id,
        createdByUserId: ids.accountA.userId,
        name: "ok",
        scopes: [],
      })
    ).rejects.toBeInstanceOf(ApiKeyError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// verifyApiKey
// ─────────────────────────────────────────────────────────────────────────

describe("verifyApiKey", () => {
  it("returns ok:true for the exact key", async () => {
    const { rawKey, row } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Verify happy",
      scopes: ["subscriptions:read"],
    });
    const r = await verifyApiKey(rawKey);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.apiKey.id).toBe(row.id);
  });

  it("returns ok:false for a tampered key (one char changed)", async () => {
    const { rawKey } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Tamper",
      scopes: ["subscriptions:read"],
    });
    const tampered = rawKey.slice(0, -1) + (rawKey.endsWith("a") ? "b" : "a");
    const r = await verifyApiKey(tampered);
    expect(r.ok).toBe(false);
  });

  it("returns ok:false for malformed input", async () => {
    expect((await verifyApiKey("")).ok).toBe(false);
    expect((await verifyApiKey("not-a-key")).ok).toBe(false);
    expect((await verifyApiKey("rr_pk_short")).ok).toBe(false);
    expect((await verifyApiKey("rr_pk_" + "g".repeat(32))).ok).toBe(false); // non-hex
  });

  it("returns ok:false for a revoked key — instantly", async () => {
    const { rawKey, row } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "To revoke",
      scopes: ["subscriptions:read"],
    });
    expect((await verifyApiKey(rawKey)).ok).toBe(true);

    await revokeApiKey({
      accountId: ids.accountA.id,
      apiKeyId: row.id,
      revokedByUserId: ids.accountA.userId,
    });
    expect((await verifyApiKey(rawKey)).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// revokeApiKey scoping
// ─────────────────────────────────────────────────────────────────────────

describe("revokeApiKey", () => {
  it("refuses to revoke a key from a different account", async () => {
    const { row } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Cross-account victim",
      scopes: ["subscriptions:read"],
    });

    // Try to revoke as accountB.
    const r = await revokeApiKey({
      accountId: ids.accountB.id, // wrong account
      apiKeyId: row.id,
      revokedByUserId: ids.accountB.userId,
    });
    expect(r).toBeNull();

    // The key is still active.
    const [after] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, row.id));
    expect(after?.revokedAt).toBeNull();
  });

  it("is idempotent on a second call", async () => {
    const { row } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Idempotent revoke",
      scopes: ["subscriptions:read"],
    });
    const first = await revokeApiKey({
      accountId: ids.accountA.id,
      apiKeyId: row.id,
      revokedByUserId: ids.accountA.userId,
    });
    expect(first?.revokedAt).not.toBeNull();
    const ts = first?.revokedAt?.getTime();

    const second = await revokeApiKey({
      accountId: ids.accountA.id,
      apiKeyId: row.id,
      revokedByUserId: ids.accountA.userId,
    });
    expect(second?.revokedAt?.getTime()).toBe(ts);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Scopes
// ─────────────────────────────────────────────────────────────────────────

describe("hasScope", () => {
  it("returns true only for granted scopes", async () => {
    const { row } = await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "Read-only",
      scopes: ["subscriptions:read"],
    });
    expect(hasScope(row, "subscriptions:read")).toBe(true);
    expect(hasScope(row, "subscriptions:write")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────

describe("listApiKeysForAccount", () => {
  it("only returns keys for the asked account", async () => {
    await createApiKey({
      accountId: ids.accountA.id,
      createdByUserId: ids.accountA.userId,
      name: "A's key",
      scopes: ["subscriptions:read"],
    });
    await createApiKey({
      accountId: ids.accountB.id,
      createdByUserId: ids.accountB.userId,
      name: "B's key",
      scopes: ["subscriptions:read"],
    });

    const aList = await listApiKeysForAccount(ids.accountA.id);
    expect(aList.length).toBe(1);
    expect(aList[0]?.name).toBe("A's key");

    const bList = await listApiKeysForAccount(ids.accountB.id);
    expect(bList.length).toBe(1);
    expect(bList[0]?.name).toBe("B's key");
  });
});
