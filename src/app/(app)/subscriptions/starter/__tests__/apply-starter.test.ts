/**
 * T3.6 — Industry starter template contract tests.
 *
 * The apply action creates drafts via createSubscriptionDraft, so the
 * invariants we already pin (no renewal event, excluded from active
 * queries, audit-logged) hold automatically. These tests pin the action's
 * own contract:
 *
 *   - Unknown profile rejected
 *   - Empty selection rejected
 *   - Happy path creates one draft per selected key
 *   - Plan cap pre-check refuses an over-capacity selection wholesale
 *     rather than partially applying it (a partial application would
 *     surprise the user and is hard to reason about)
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

import { applyStarterTemplateAction } from "@app/(app)/subscriptions/starter/actions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
  await db
    .update(accountsTable)
    .set({ planTier: "growth" })
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

describe("applyStarterTemplateAction guard rails", () => {
  it("rejects an unknown profile", async () => {
    const r = await applyStarterTemplateAction({
      // @ts-expect-error — exercising the runtime guard
      profile: "completely_made_up",
      selectedKeys: ["whatever"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/unknown template/i);
  });

  it("rejects an empty selection", async () => {
    const r = await applyStarterTemplateAction({
      profile: "startup_small",
      selectedKeys: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/at least one/i);
  });
});

describe("applyStarterTemplateAction happy path", () => {
  it("creates one draft per known selected key", async () => {
    const r = await applyStarterTemplateAction({
      profile: "startup_small",
      selectedKeys: ["slack-pro-small", "notion-team-small", "figma-pro-small"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(3);
    expect(r.skipped).toBe(0);

    const drafts = await db
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountA.id));
    // 1 seed (active) + 3 drafts
    expect(drafts.length).toBe(4);
    expect(drafts.filter((d) => d.status === "draft").length).toBe(3);
  });

  it("silently filters out unknown keys without failing the batch", async () => {
    const r = await applyStarterTemplateAction({
      profile: "startup_small",
      selectedKeys: ["slack-pro-small", "not-in-template"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(1);
  });
});

describe("applyStarterTemplateAction plan cap", () => {
  it("refuses the batch when the selection would exceed maxSubscriptions", async () => {
    // Drop to free_forever (5-sub cap). Seed already has 1.
    await db
      .update(accountsTable)
      .set({ planTier: "free_forever" })
      .where(eq(accountsTable.id, ids.accountA.id));
    const [account] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, ids.accountA.id));
    mockedAccount = account;

    const r = await applyStarterTemplateAction({
      profile: "startup_small",
      // 6 keys + 1 existing = 7 > 5 cap
      selectedKeys: [
        "slack-pro-small",
        "notion-team-small",
        "figma-pro-small",
        "github-team-small",
        "linear-standard-small",
        "vercel-pro-small",
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.formError).toMatch(/plan limit/i);

    // Nothing was created — the refusal is wholesale.
    const drafts = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.accountId, ids.accountA.id));
    expect(drafts.length).toBe(1); // just the seed
  });
});
