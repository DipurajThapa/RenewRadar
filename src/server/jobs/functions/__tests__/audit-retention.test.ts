/**
 * Audit-log retention cron tests.
 *
 * Verifies the tier-keyed retention window deletes old entries and posts
 * a single audit_log.purged entry per affected account.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  auditLogTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { runAuditRetention } from "@server/jobs/functions/audit-retention";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

const NOW = new Date("2026-06-15T12:00:00Z");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function seedAuditEntry(
  accountId: string,
  daysAgoVal: number
): Promise<void> {
  await db.insert(auditLogTable).values({
    accountId,
    actorUserId: null,
    action: "subscription.created",
    targetEntityType: "subscription",
    targetEntityId: ids.accountA.subscriptionId,
    createdAt: daysAgo(daysAgoVal),
  });
}

async function countAuditRows(accountId: string): Promise<number> {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.accountId, accountId));
  return rows.length;
}

describe("runAuditRetention", () => {
  it("free_forever: deletes entries older than 30 days", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));

    await seedAuditEntry(ids.accountA.id, 31); // expired
    await seedAuditEntry(ids.accountA.id, 29); // kept

    // Seed already creates 1 baseline entry per account; the harness
    // makes it fresh (today), which stays under any retention. We assume
    // total = 3 before, 2 after (1 expired removed, 1 purged audit added).
    await runAuditRetention(NOW);

    const remaining = await countAuditRows(ids.accountA.id);
    // 1 seed + 1 kept(29d) + 1 new purge entry = 3. The expired 31-day
    // entry is gone.
    expect(remaining).toBe(3);
  });

  it("starter: keeps entries up to 365 days", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "starter" })
      .where(eq(accountsTable.id, ids.accountA.id));

    await seedAuditEntry(ids.accountA.id, 364); // kept
    await seedAuditEntry(ids.accountA.id, 366); // expired

    await runAuditRetention(NOW);

    const remaining = await countAuditRows(ids.accountA.id);
    // 1 seed + 1 kept + 1 purge entry = 3.
    expect(remaining).toBe(3);
  });

  it("does NOT post a purge entry when nothing was deleted", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "starter" })
      .where(eq(accountsTable.id, ids.accountA.id));

    await seedAuditEntry(ids.accountA.id, 100); // well within retention

    const beforeCount = await countAuditRows(ids.accountA.id);
    await runAuditRetention(NOW);
    const afterCount = await countAuditRows(ids.accountA.id);

    expect(afterCount).toBe(beforeCount);
  });

  it("scopes deletions per-account (B's old entries don't get deleted when A is processed)", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));
    await db
      .update(accountsTable)
      .set({ planTier: "enterprise" })
      .where(eq(accountsTable.id, ids.accountB.id));

    await seedAuditEntry(ids.accountA.id, 31);
    await seedAuditEntry(ids.accountB.id, 31);

    await runAuditRetention(NOW);

    // Account A (free, 30d retention) drops the 31d entry; account B
    // (enterprise, 7yr retention) keeps it.
    const aRows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.accountId, ids.accountA.id));
    const bRows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.accountId, ids.accountB.id));
    // A: 1 seed + 1 new purge entry = 2 (the 31-day entry was deleted).
    expect(aRows.length).toBe(2);
    // B: 1 seed + 1 kept 31-day entry = 2 (no purge entry because
    // enterprise retention is 7 years and nothing was deleted).
    expect(bRows.length).toBe(2);
  });

  it("posts exactly one purge entry per affected account", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));

    await seedAuditEntry(ids.accountA.id, 31);
    await seedAuditEntry(ids.accountA.id, 60);
    await seedAuditEntry(ids.accountA.id, 100);

    await runAuditRetention(NOW);

    const purgeRows = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.accountId, ids.accountA.id),
          eq(auditLogTable.action, "audit_log.purged")
        )
      );
    expect(purgeRows.length).toBe(1);
  });
});
