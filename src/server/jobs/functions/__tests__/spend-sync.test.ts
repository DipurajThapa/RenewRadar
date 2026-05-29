/**
 * Spend-sync cron tests (REV-5). The daily job must ingest + detect only for
 * accounts whose plan still includes spend auto-discovery, and skip the rest —
 * otherwise a paid→free downgrade would keep ingesting (and, with Ramp keys,
 * cost money) for free.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  spendConnectionsTable,
  spendTransactionsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { encryptJson } from "@server/infrastructure/crypto/envelope";
import { runSpendSync } from "@server/jobs/functions/spend-sync";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  // A = paid (has the feature); B = free_forever (does not).
  await db
    .update(accountsTable)
    .set({ planTier: "starter" })
    .where(eq(accountsTable.id, ids.accountA.id));
  await db
    .update(accountsTable)
    .set({ planTier: "free_forever" })
    .where(eq(accountsTable.id, ids.accountB.id));
  for (const accountId of [ids.accountA.id, ids.accountB.id]) {
    await db.insert(spendConnectionsTable).values({
      accountId,
      kind: "fixture",
      configCiphertext: encryptJson(accountId, { datasetId: "default" }),
      status: "active",
    });
  }
});

// pass-through step runner: exercises the loop without the Inngest runtime
const passThrough = <T>(_id: string, fn: () => Promise<T>) => fn();

describe("runSpendSync tier gating (REV-5)", () => {
  it("processes the paid account and skips the free one", async () => {
    const result = await runSpendSync(passThrough);
    expect(result.connections).toBe(2);
    expect(result.skipped).toBe(1); // the free_forever account
    expect(result.ingested).toBeGreaterThan(0); // the paid account ingested

    // The free account ingested NOTHING (cron never touched it).
    const bRows = await db
      .select()
      .from(spendTransactionsTable)
      .where(eq(spendTransactionsTable.accountId, ids.accountB.id));
    expect(bRows.length).toBe(0);

    // The paid account DID ingest.
    const aRows = await db
      .select()
      .from(spendTransactionsTable)
      .where(eq(spendTransactionsTable.accountId, ids.accountA.id));
    expect(aRows.length).toBeGreaterThan(0);
  });

  it("skips ALL connections when no account has the feature", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));
    const result = await runSpendSync(passThrough);
    expect(result.skipped).toBe(2);
    expect(result.ingested).toBe(0);
    expect(result.detected).toBe(0);
  });
});
