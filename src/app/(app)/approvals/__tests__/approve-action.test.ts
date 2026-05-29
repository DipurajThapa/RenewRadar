/**
 * approveRenewalDecisionAction server-action tests.
 *
 * Audit gap C2: pre-fix every user-facing server action was untested. The
 * approvals flow is the highest-stakes one because it enforces
 * separation-of-duties: the same user who recorded the decision cannot
 * approve it. A bug here defeats the entire reason approvals exist.
 *
 * Mocks `getCurrentAccountAndUser` and `revalidatePath` so we can call the
 * action like a unit test rather than spinning up a full Next request.
 * Everything below that mock — schema validation, transaction, RBAC,
 * tier gate, savings derivation — runs against the real test DB.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  renewalEventsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import type { Account, User } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

// ─── Mock the request-scope resolver before importing the action. ───────
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
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { approveRenewalDecisionAction } from "@app/(app)/approvals/actions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();

  // Both seeded accounts need Growth+ to pass the approvalsLite tier check.
  await db
    .update(accountsTable)
    .set({ planTier: "growth" })
    .where(eq(accountsTable.id, ids.accountA.id));
  await db
    .update(accountsTable)
    .set({ planTier: "growth" })
    .where(eq(accountsTable.id, ids.accountB.id));
});

/**
 * Move the renewal event into the "pending approval" state with a recorded
 * decision so the approval action has something to act on.
 */
async function stageDecision(args: {
  renewalEventId: string;
  decidedByUserId: string;
  decision?: "renewed" | "renewed_with_adjustments" | "downgraded" | "cancelled";
}): Promise<void> {
  await db
    .update(renewalEventsTable)
    .set({
      decision: args.decision ?? "renewed",
      decidedByUserId: args.decidedByUserId,
      decisionAt: new Date(),
      approvalStatus: "pending",
    })
    .where(eq(renewalEventsTable.id, args.renewalEventId));
}

async function makeAdmin(userId: string): Promise<User> {
  const [updated] = await db
    .update(usersTable)
    .set({ role: "admin" })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!updated) throw new Error("makeAdmin failed");
  return updated;
}

async function getAccount(accountId: string): Promise<Account> {
  const [row] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  if (!row) throw new Error("getAccount failed");
  return row;
}

async function getUser(userId: string): Promise<User> {
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) throw new Error("getUser failed");
  return row;
}

async function getRenewalApprovalStatus(eventId: string): Promise<string> {
  const [row] = await db
    .select({ status: renewalEventsTable.approvalStatus })
    .from(renewalEventsTable)
    .where(eq(renewalEventsTable.id, eventId));
  return row?.status ?? "missing";
}

// ─────────────────────────────────────────────────────────────────────────
// Separation of duties — the wedge invariant
// ─────────────────────────────────────────────────────────────────────────

describe("approveRenewalDecisionAction — separation of duties", () => {
  it("refuses to let a user approve their own decision", async () => {
    const admin = await makeAdmin(ids.accountA.userId);
    await stageDecision({
      renewalEventId: ids.accountA.renewalEventId,
      decidedByUserId: admin.id,
    });
    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = admin;

    const result = await approveRenewalDecisionAction(
      ids.accountA.renewalEventId,
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot approve your own/i);
    }
    expect(await getRenewalApprovalStatus(ids.accountA.renewalEventId)).toBe(
      "pending"
    );
  });

  it("allows a different admin from the same account to approve", async () => {
    // Owner records the decision; a second admin approves.
    await stageDecision({
      renewalEventId: ids.accountA.renewalEventId,
      decidedByUserId: ids.accountA.userId, // owner from seed
    });
    // Add a second user (admin) to account A.
    const [secondAdmin] = await db
      .insert(usersTable)
      .values({
        accountId: ids.accountA.id,
        clerkUserId: `clerk_admin_${Date.now()}`,
        workEmail: "admin2@a.example.test",
        fullName: "Second Admin",
        role: "admin",
        notificationPrefs: {},
      })
      .returning();
    if (!secondAdmin) throw new Error("seed admin failed");

    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = secondAdmin;

    const result = await approveRenewalDecisionAction(
      ids.accountA.renewalEventId,
      true
    );
    expect(result.ok).toBe(true);
    expect(await getRenewalApprovalStatus(ids.accountA.renewalEventId)).toBe(
      "approved"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RBAC + tier gates
// ─────────────────────────────────────────────────────────────────────────

describe("approveRenewalDecisionAction — RBAC + tier", () => {
  it("rejects a non-admin user (member role)", async () => {
    await stageDecision({
      renewalEventId: ids.accountA.renewalEventId,
      decidedByUserId: ids.accountA.userId,
    });
    // Demote the user to member.
    await db
      .update(usersTable)
      .set({ role: "member" })
      .where(eq(usersTable.id, ids.accountA.userId));

    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = await getUser(ids.accountA.userId);

    const result = await approveRenewalDecisionAction(
      ids.accountA.renewalEventId,
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/admin access required/i);
  });

  it("rejects a Starter-tier account (approvalsLite is Growth+)", async () => {
    // Downgrade tier so the requireTierFeature gate fires.
    await db
      .update(accountsTable)
      .set({ planTier: "starter" })
      .where(eq(accountsTable.id, ids.accountA.id));
    const admin = await makeAdmin(ids.accountA.userId);
    await stageDecision({
      renewalEventId: ids.accountA.renewalEventId,
      decidedByUserId: admin.id,
    });
    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = admin;

    const result = await approveRenewalDecisionAction(
      ids.accountA.renewalEventId,
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Growth/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cross-account guard
// ─────────────────────────────────────────────────────────────────────────

describe("approveRenewalDecisionAction — cross-account", () => {
  it("refuses to approve a renewal event from a different account", async () => {
    const aAdmin = await makeAdmin(ids.accountA.userId);
    await stageDecision({
      renewalEventId: ids.accountB.renewalEventId, // B's event
      decidedByUserId: ids.accountB.userId,
    });
    // Caller is account A's admin trying to act on B's event.
    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = aAdmin;

    const result = await approveRenewalDecisionAction(
      ids.accountB.renewalEventId,
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/Renewal event not found|not pending/i);
    // B's event still pending.
    expect(await getRenewalApprovalStatus(ids.accountB.renewalEventId)).toBe(
      "pending"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────

describe("approveRenewalDecisionAction — input validation", () => {
  it("rejects a non-UUID renewal event ID", async () => {
    const admin = await makeAdmin(ids.accountA.userId);
    mockedAccount = await getAccount(ids.accountA.id);
    mockedUser = admin;

    const result = await approveRenewalDecisionAction("not-a-uuid", true);
    expect(result.ok).toBe(false);
  });
});
