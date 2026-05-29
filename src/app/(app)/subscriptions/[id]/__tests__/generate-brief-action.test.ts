/**
 * generateBriefAction server-action tests (REV-1 + REV-3).
 *
 *   REV-1: the Renewal Intelligence Brief is a paid feature — free_forever is
 *          denied at the action boundary (not just hidden in the UI).
 *   REV-3: regeneration is rate-limited per account+subscription so it can't be
 *          looped to stack briefs / burn LLM tokens.
 *
 * Mocks the request-scope resolver + revalidatePath so the action runs like a
 * unit test; everything below (tier gate, rate limit, generation) hits the real
 * test DB + in-memory rate limiter.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import type { Account, User } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  _resetRateLimitForTests,
  BRIEF_GENERATION_POLICY,
} from "@server/infrastructure/rate-limit";

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

import { generateBriefAction } from "@app/(app)/subscriptions/[id]/actions";

let ids: SeedTwoAccountsResult;
let subscriptionId: string;

beforeAll(async () => {
  await ensureMigrated();
});

async function loadAccountUser(accountId: string, userId: string) {
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  const { usersTable } = await import("@server/infrastructure/db/schema");
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return { account: account!, user: user! };
}

beforeEach(async () => {
  await truncateAll();
  _resetRateLimitForTests();
  ids = await seedTwoAccounts();
  subscriptionId = ids.accountA.subscriptionId;
  // Default: Starter — includes the renewal brief.
  await db
    .update(accountsTable)
    .set({ planTier: "starter" })
    .where(eq(accountsTable.id, ids.accountA.id));
  const loaded = await loadAccountUser(ids.accountA.id, ids.accountA.userId);
  mockedAccount = loaded.account;
  mockedUser = loaded.user;
});

describe("generateBriefAction tier gate (REV-1)", () => {
  it("denies free_forever with an upgrade message", async () => {
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));
    mockedAccount = (await loadAccountUser(ids.accountA.id, ids.accountA.userId)).account;

    const r = await generateBriefAction(subscriptionId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Renewal intelligence brief|Starter/i);
  });

  it("allows a Starter account to generate", async () => {
    const r = await generateBriefAction(subscriptionId);
    expect(r.ok).toBe(true);
  });
});

describe("generateBriefAction rate limit (REV-3)", () => {
  it("throttles after the per-account+subscription limit", async () => {
    for (let i = 0; i < BRIEF_GENERATION_POLICY.limit; i++) {
      const r = await generateBriefAction(subscriptionId);
      expect(r.ok).toBe(true);
    }
    const denied = await generateBriefAction(subscriptionId);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatch(/too many/i);
  });
});
