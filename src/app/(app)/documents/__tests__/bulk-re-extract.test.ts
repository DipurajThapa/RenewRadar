/**
 * T3.7 — Bulk re-extraction action contract tests.
 *
 * The action fires one Inngest event per qualifying document, skips
 * documents currently mid-extraction, and is gated to admin/owner only
 * (re-extraction can burn the whole monthly AI budget).
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  documentsTable,
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
const inngestSend = vi.fn().mockResolvedValue(undefined);
vi.mock("@server/jobs/client", () => ({
  inngest: { send: (...args: unknown[]) => inngestSend(...args) },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { bulkReExtractAction } from "@app/(app)/documents/actions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  inngestSend.mockClear();
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

async function seedDocs(args: {
  accountId: string;
  uploadedByUserId: string;
  count: number;
  status?: "pending" | "ready" | "failed";
}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < args.count; i++) {
    const [doc] = await db
      .insert(documentsTable)
      .values({
        accountId: args.accountId,
        uploadedByUserId: args.uploadedByUserId,
        kind: "contract" as const,
        filename: `doc-${i}-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/doc-${i}-${Date.now()}.pdf`,
        checksumSha256: `dummy-${i}-${Date.now()}`,
        textExtractionStatus: args.status ?? "ready",
      })
      .returning({ id: documentsTable.id });
    if (doc) ids.push(doc.id);
  }
  return ids;
}

describe("bulkReExtractAction admin gating", () => {
  it("refuses member-role users", async () => {
    // Demote the seed user (default 'owner') to 'member' so the admin
    // gate has work to do.
    await db
      .update(usersTable)
      .set({ role: "member" })
      .where(eq(usersTable.id, ids.accountA.userId));
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ids.accountA.userId));
    mockedUser = user;

    const r = await bulkReExtractAction();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/admin/i);
  });
});

describe("bulkReExtractAction dispatching", () => {
  beforeEach(async () => {
    // Promote the seed user to owner so the admin gate passes.
    await db
      .update(usersTable)
      .set({ role: "owner" })
      .where(eq(usersTable.id, ids.accountA.userId));
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ids.accountA.userId));
    mockedUser = user;
  });

  it("fires one Inngest event per ready document", async () => {
    await seedDocs({
      accountId: ids.accountA.id,
      uploadedByUserId: ids.accountA.userId,
      count: 3,
      status: "ready",
    });

    const r = await bulkReExtractAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dispatched).toBe(3);
    expect(r.skippedInFlight).toBe(0);
    expect(inngestSend).toHaveBeenCalledTimes(3);
  });

  it("skips documents currently mid-extraction", async () => {
    await seedDocs({
      accountId: ids.accountA.id,
      uploadedByUserId: ids.accountA.userId,
      count: 2,
      status: "ready",
    });
    await seedDocs({
      accountId: ids.accountA.id,
      uploadedByUserId: ids.accountA.userId,
      count: 2,
      status: "pending",
    });

    const r = await bulkReExtractAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dispatched).toBe(2);
    expect(r.skippedInFlight).toBe(2);
  });

  it("does not dispatch events for documents belonging to another account", async () => {
    // Account B has its own seed user; create some documents on B.
    await seedDocs({
      accountId: ids.accountB.id,
      uploadedByUserId: ids.accountB.userId,
      count: 5,
      status: "ready",
    });

    const r = await bulkReExtractAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dispatched).toBe(0);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("returns 0/0 when the account has no documents at all", async () => {
    const r = await bulkReExtractAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dispatched).toBe(0);
    expect(r.skippedInFlight).toBe(0);
  });
});
