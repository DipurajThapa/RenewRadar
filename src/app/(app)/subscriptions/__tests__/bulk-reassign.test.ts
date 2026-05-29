/**
 * Bulk owner reassignment (T2.6) contract tests.
 *
 * After an import, the user can reassign owners en masse. The action must:
 *   - Refuse cross-account subscription IDs
 *   - Refuse owner IDs that aren't members of the account
 *   - Continue processing remaining assignments after a per-row failure
 *   - Write through `updateSubscription` so the existing audit-log /
 *     vendor-event behavior on owner changes is preserved (no parallel
 *     mutation path).
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
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

import { bulkReassignOwnersAction } from "@app/(app)/subscriptions/import-actions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
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

// Seed a second user in accountA so we have a different owner to reassign to.
async function makeSecondUserInA(): Promise<string> {
  const [u] = await db
    .insert(usersTable)
    .values({
      accountId: ids.accountA.id,
      clerkUserId: `clerk_a_second_${Date.now()}`,
      workEmail: "second@a.example.test",
      fullName: "Second User A",
    })
    .returning();
  if (!u) throw new Error("seed failed");
  return u.id;
}

describe("bulkReassignOwnersAction happy path", () => {
  it("reassigns the seeded subscription to a different account user", async () => {
    const secondUserId = await makeSecondUserInA();

    const r = await bulkReassignOwnersAction({
      assignments: [
        {
          subscriptionId: ids.accountA.subscriptionId,
          ownerUserId: secondUserId,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(1);
    expect(r.failed).toBe(0);

    const [sub] = await db
      .select({ ownerUserId: subscriptionsTable.ownerUserId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    expect(sub?.ownerUserId).toBe(secondUserId);
  });

  it("accepts null to unassign the owner", async () => {
    const r = await bulkReassignOwnersAction({
      assignments: [
        {
          subscriptionId: ids.accountA.subscriptionId,
          ownerUserId: null,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(1);

    const [sub] = await db
      .select({ ownerUserId: subscriptionsTable.ownerUserId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, ids.accountA.subscriptionId));
    expect(sub?.ownerUserId).toBeNull();
  });
});

describe("bulkReassignOwnersAction guard rails", () => {
  it("rejects an empty assignments array", async () => {
    const r = await bulkReassignOwnersAction({ assignments: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/no assignments/i);
  });

  it("records per-row failure for a cross-account subscription id", async () => {
    // Trying to update accountB's subscription from accountA's context.
    const secondUserId = await makeSecondUserInA();
    const r = await bulkReassignOwnersAction({
      assignments: [
        {
          subscriptionId: ids.accountB.subscriptionId,
          ownerUserId: secondUserId,
        },
        {
          subscriptionId: ids.accountA.subscriptionId,
          ownerUserId: secondUserId,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(1); // accountA only
    expect(r.failed).toBe(1);
    expect(r.failures[0]?.subscriptionId).toBe(ids.accountB.subscriptionId);
    expect(r.failures[0]?.error).toMatch(/not found in this account/i);
  });

  it("records per-row failure for an owner who isn't in the account", async () => {
    const r = await bulkReassignOwnersAction({
      assignments: [
        {
          subscriptionId: ids.accountA.subscriptionId,
          ownerUserId: ids.accountB.userId, // owner from the other account
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.failures[0]?.error).toMatch(/member of this account/i);
  });
});
