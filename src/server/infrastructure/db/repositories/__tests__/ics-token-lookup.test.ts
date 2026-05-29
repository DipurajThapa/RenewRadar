/**
 * ICS token lookup tests — covers the CPU-exhaustion DoS fix (audit H3) and
 * the enabled-flag honored gate (audit M3).
 *
 * Pre-fix: `findAccountByIcsToken` scanned every account's row and ran
 * scrypt to decrypt each one. Any unauthenticated caller could exhaust CPU
 * by hitting `/api/calendar/<garbage>.ics` repeatedly.
 *
 * Post-fix: an indexed `token_lookup_hash` column lets the query resolve
 * to a single candidate row regardless of account count, AND the lookup
 * filters by `enabled=true` so a disabled integration's feed actually stops
 * serving.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { integrationsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  computeIcsTokenLookupHash,
  findAccountByIcsToken,
} from "@server/infrastructure/db/repositories/integrations";
import {
  backfillIcsTokenLookupHashes,
  upsertIntegration,
} from "@server/application/integrations";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

async function seedIcs(accountId: string, token: string): Promise<void> {
  await upsertIntegration({
    accountId,
    actorUserId: ids.accountA.userId, // any actor — audit log only
    kind: "ics_export",
    config: { token },
    enabled: true,
  });
}

describe("findAccountByIcsToken — happy path", () => {
  it("returns the matching account for a valid token", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    const result = await findAccountByIcsToken(TOKEN_A);
    expect(result).toEqual({ accountId: ids.accountA.id });
  });

  it("returns null for an unknown token", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    expect(await findAccountByIcsToken(TOKEN_B)).toBeNull();
    expect(await findAccountByIcsToken("not-even-hex")).toBeNull();
  });

  it("returns null for an empty token (no scan)", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    expect(await findAccountByIcsToken("")).toBeNull();
  });

  it("does not cross-account leak", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    await seedIcs(ids.accountB.id, TOKEN_B);
    expect(await findAccountByIcsToken(TOKEN_A)).toEqual({
      accountId: ids.accountA.id,
    });
    expect(await findAccountByIcsToken(TOKEN_B)).toEqual({
      accountId: ids.accountB.id,
    });
  });
});

describe("findAccountByIcsToken — enabled=false (audit M3)", () => {
  it("does not match a disabled integration", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    // Flip enabled=false directly to simulate what `disableIcsExportAction`
    // does. (We could go through the action, but the DB state is what
    // matters for the lookup.)
    await db
      .update(integrationsTable)
      .set({ enabled: false })
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(await findAccountByIcsToken(TOKEN_A)).toBeNull();
  });

  it("matching can resume after enabling the integration again", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    await db
      .update(integrationsTable)
      .set({ enabled: false })
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(await findAccountByIcsToken(TOKEN_A)).toBeNull();
    await db
      .update(integrationsTable)
      .set({ enabled: true })
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(await findAccountByIcsToken(TOKEN_A)).toEqual({
      accountId: ids.accountA.id,
    });
  });
});

describe("token_lookup_hash invariant", () => {
  it("upsertIntegration persists the SHA-256 of the token", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    const [row] = await db
      .select({ hash: integrationsTable.tokenLookupHash })
      .from(integrationsTable)
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(row?.hash).toBe(computeIcsTokenLookupHash(TOKEN_A));
  });

  it("rotating the token updates the hash", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    await seedIcs(ids.accountA.id, TOKEN_B); // upsert with a new token
    const [row] = await db
      .select({ hash: integrationsTable.tokenLookupHash })
      .from(integrationsTable)
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(row?.hash).toBe(computeIcsTokenLookupHash(TOKEN_B));
    // The old token no longer resolves.
    expect(await findAccountByIcsToken(TOKEN_A)).toBeNull();
    expect(await findAccountByIcsToken(TOKEN_B)).toEqual({
      accountId: ids.accountA.id,
    });
  });

  it("slack_webhook integrations leave the hash null", async () => {
    await upsertIntegration({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      kind: "slack_webhook",
      config: { webhookUrl: "https://hooks.slack.com/services/T/B/abc" },
      enabled: true,
    });
    const [row] = await db
      .select({ hash: integrationsTable.tokenLookupHash })
      .from(integrationsTable)
      .where(eq(integrationsTable.accountId, ids.accountA.id));
    expect(row?.hash).toBeNull();
  });
});

describe("backfillIcsTokenLookupHashes", () => {
  it("populates null hashes for legacy ICS rows and leaves populated rows alone", async () => {
    // Simulate a row that was inserted before the hash column existed:
    // upsert as normal, then null the hash out by hand.
    await seedIcs(ids.accountA.id, TOKEN_A);
    await seedIcs(ids.accountB.id, TOKEN_B);
    await db
      .update(integrationsTable)
      .set({ tokenLookupHash: null })
      .where(eq(integrationsTable.accountId, ids.accountA.id));

    const result = await backfillIcsTokenLookupHashes();
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);

    // Both accounts should now resolve through the indexed lookup.
    expect(await findAccountByIcsToken(TOKEN_A)).toEqual({
      accountId: ids.accountA.id,
    });
    expect(await findAccountByIcsToken(TOKEN_B)).toEqual({
      accountId: ids.accountB.id,
    });
  });

  it("is idempotent — a second run finds nothing to do", async () => {
    await seedIcs(ids.accountA.id, TOKEN_A);
    const first = await backfillIcsTokenLookupHashes();
    expect(first.scanned).toBe(0); // upsert already populated the hash
    const second = await backfillIcsTokenLookupHashes();
    expect(second.scanned).toBe(0);
  });
});
