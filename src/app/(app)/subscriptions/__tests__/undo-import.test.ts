/**
 * Import undo (T4.15) — contract tests.
 *
 * Invariants:
 *   - Successful commit produces an importBatchId in the response.
 *   - Undo within window cancels every row the batch created and ONLY
 *     those rows — a subscription the user added separately must survive.
 *   - Undo respects the 24h window: a batch older than the window is
 *     rejected with a clear message, no state change.
 *   - Re-undo (second undo of an already-undone batch) is rejected.
 *   - Cross-account undo is rejected (an attacker can't undo someone
 *     else's import even with the batch ID).
 *   - Rows the user already modified out of `active` are NOT silently
 *     cancelled by undo (we don't bulldoze a manual decision).
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  importBatchesTable,
  subscriptionsTable,
  usersTable,
  type Account,
  type User,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

let mockedAccount: Account | undefined;
let mockedUser: User | undefined;
vi.mock("@server/middleware/current-user", () => ({
  getCurrentAccountAndUser: async () => {
    if (!mockedAccount || !mockedUser) {
      throw new Error("test setup forgot to set mocked account/user");
    }
    return { account: mockedAccount, user: mockedUser };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  importSubscriptionsCsvAction,
  undoImportBatchAction,
} from "@app/(app)/subscriptions/import-actions";

let ids: SeedTwoAccountsResult;

const HEADER =
  "vendor,product,billing_cycle,term_start,term_end,notice_period_days,seats,unit_price_usd,auto_renew";

function row(vendor: string, product: string): string {
  return [
    vendor,
    product,
    "annual",
    "2026-01-01",
    "2027-01-01",
    "30",
    "10",
    "100",
    "true",
  ].join(",");
}

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  await db
    .update(accountsTable)
    .set({ planTier: "starter" })
    .where(eq(accountsTable.id, ids.accountA.id));
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, ids.accountA.id));
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, ids.accountA.userId));
  mockedAccount = account;
  mockedUser = user;
});

async function importTwo(): Promise<string> {
  const csv = [HEADER, row("Linear", "Standard"), row("Figma", "Pro")].join(
    "\n"
  );
  const r = await importSubscriptionsCsvAction(csv);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("import failed");
  expect(r.imported).toBe(2);
  expect(r.importBatchId).toBeTruthy();
  return r.importBatchId!;
}

// ─────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────

describe("undoImportBatchAction happy path", () => {
  it("cancels exactly the rows the batch created", async () => {
    const batchId = await importTwo();

    const r = await undoImportBatchAction(batchId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.undoneCount).toBe(2);

    // The two imported rows are now cancelled; the seed row is untouched.
    const all = await db
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountA.id));
    const cancelled = all.filter((s) => s.status === "cancelled").length;
    const active = all.filter((s) => s.status === "active").length;
    expect(cancelled).toBe(2);
    expect(active).toBe(1);
  });

  it("marks the batch as undone", async () => {
    const batchId = await importTwo();
    await undoImportBatchAction(batchId);
    const [batch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
    expect(batch?.undoneAt).not.toBeNull();
    expect(batch?.undoneByUserId).toBe(ids.accountA.userId);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Guard rails
// ─────────────────────────────────────────────────────────────────────────

describe("undoImportBatchAction guard rails", () => {
  it("rejects undo when batch is older than 24h", async () => {
    const batchId = await importTwo();
    // Backdate the batch by 25 hours.
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(importBatchesTable)
      .set({ createdAt: oldDate })
      .where(eq(importBatchesTable.id, batchId));

    const r = await undoImportBatchAction(batchId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/24 hours/i);

    // State unchanged.
    const cancelled = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, "cancelled"));
    expect(cancelled.length).toBe(0);
  });

  it("rejects second undo of an already-undone batch", async () => {
    const batchId = await importTwo();
    const first = await undoImportBatchAction(batchId);
    expect(first.ok).toBe(true);

    const second = await undoImportBatchAction(batchId);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.formError).toMatch(/already been undone/i);
  });

  it("rejects undo of a batch from a different account", async () => {
    // Run the import as accountA, then try to undo as accountB.
    const batchId = await importTwo();

    // Switch mocked context to accountB.
    const [accountB] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, ids.accountB.id));
    const [userB] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ids.accountB.userId));
    mockedAccount = accountB;
    mockedUser = userB;

    const r = await undoImportBatchAction(batchId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/not found/i);
  });

  it("rejects undo for an unknown batch id", async () => {
    const r = await undoImportBatchAction(
      "00000000-0000-0000-0000-000000000999"
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// "Don't bulldoze a manual decision" — rows the user already moved off
// `active` should be left alone by undo.
// ─────────────────────────────────────────────────────────────────────────

describe("undoImportBatchAction preserves manual decisions", () => {
  it("does not touch rows whose status the user already changed", async () => {
    const batchId = await importTwo();

    // The user cancels one of the imported rows manually before clicking
    // undo. Undo should leave that decision alone and only cancel the
    // remaining still-active row(s) from the batch.
    const [batch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
    const firstId = batch?.subscriptionIdsJson?.[0];
    if (!firstId) throw new Error("batch has no rows");
    await db
      .update(subscriptionsTable)
      .set({ status: "pending_cancellation" })
      .where(eq(subscriptionsTable.id, firstId));

    const r = await undoImportBatchAction(batchId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only the other row was undone; the manually-touched row was skipped.
    expect(r.undoneCount).toBe(1);

    const [touched] = await db
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, firstId));
    expect(touched?.status).toBe("pending_cancellation");
  });
});
