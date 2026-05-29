/**
 * Seat-cap enforcement tests for the invitation flow.
 *
 * Covers:
 *   - Hitting the boundary: at-limit → next invite throws SeatLimitExceededError
 *   - Re-inviting a still-pending email does NOT count as new seat
 *   - Expired invitations don't count toward the cap
 *   - Accepted invitations DO count (they're now real users)
 *   - Unlimited tiers (enterprise) never throw
 *   - The error carries machine-readable fields for upgrade nudges
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  invitationsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  createInvitation,
  SeatLimitExceededError,
  acceptInvitation,
} from "@server/application/invitations";
import {
  countActiveUsers,
} from "@server/infrastructure/db/repositories/users";
import {
  countPendingInvitations,
} from "@server/infrastructure/db/repositories/invitations";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

async function setAccountTier(
  accountId: string,
  planTier: "free_forever" | "starter" | "growth" | "pro" | "enterprise"
): Promise<void> {
  await db
    .update(accountsTable)
    .set({ planTier })
    .where(eq(accountsTable.id, accountId));
}

describe("createInvitation seat cap", () => {
  it("free_forever rejects every invite (cap=1, owner already seated)", async () => {
    await setAccountTier(ids.accountA.id, "free_forever");
    await expect(
      createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "second@a.example.test",
        role: "member",
        accountPlanTier: "free_forever",
      })
    ).rejects.toBeInstanceOf(SeatLimitExceededError);
  });

  it("starter allows up to 3 seats total (1 owner + 2 invites)", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    // Owner exists from seed. Two invites take us to 3.
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "second@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "third@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // The 4th invite must be rejected.
    await expect(
      createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "fourth@a.example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).rejects.toBeInstanceOf(SeatLimitExceededError);
  });

  it("re-inviting a pending email rotates the token without bumping seat count", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    // Fill to the cap.
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "second@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    const firstInvite = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "third@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // Re-invite the same email — should succeed (rotate token), not throw.
    const reinvited = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "third@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    expect(reinvited.id).toBe(firstInvite.id); // same row, rotated token
    expect(reinvited.token).not.toBe(firstInvite.token);

    // Net pending count stays at 2 (no double-count).
    const pending = await countPendingInvitations(ids.accountA.id);
    expect(pending).toBe(2);
  });

  it("expired invitations don't count toward the cap", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "second@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "third@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // Force the second invite to be expired.
    await db
      .update(invitationsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitationsTable.email, "second@a.example.test"));

    // Now there's room: 1 active + 1 pending = 2 of 3.
    await expect(
      createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "fourth@a.example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).resolves.toBeDefined();
  });

  it("accepted invitations count as users (no double-count of pending row)", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    const inv = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "second@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // Insert a User row simulating the accept (provisionNewUser does the user
    // insert then calls acceptInvitation; we do both here).
    const [newUser] = await db
      .insert(usersTable)
      .values({
        accountId: ids.accountA.id,
        clerkUserId: `clerk_test_${Date.now()}`,
        workEmail: "second@a.example.test",
        fullName: "Second",
        role: "member",
        notificationPrefs: {},
      })
      .returning();
    if (!newUser) throw new Error("seed failed");
    await acceptInvitation({
      invitationId: inv.id,
      acceptedByUserId: newUser.id,
    });

    // Cap state: 2 users (owner + new), 0 pending. Still room for 1 more.
    expect(await countActiveUsers(ids.accountA.id)).toBe(2);
    expect(await countPendingInvitations(ids.accountA.id)).toBe(0);

    await expect(
      createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "third@a.example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).resolves.toBeDefined();

    // And now we should be at the cap.
    await expect(
      createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "fourth@a.example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).rejects.toBeInstanceOf(SeatLimitExceededError);
  });

  it("enterprise (unlimited) never throws", async () => {
    await setAccountTier(ids.accountA.id, "enterprise");

    // Fire 25 invites to far exceed any other tier's cap.
    for (let i = 0; i < 25; i++) {
      await expect(
        createInvitation({
          accountId: ids.accountA.id,
          actorUserId: ids.accountA.userId,
          email: `user-${i}@a.example.test`,
          role: "member",
          accountPlanTier: "enterprise",
        })
      ).resolves.toBeDefined();
    }
  });

  it("error carries machine-readable fields for upgrade nudges", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "second@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "third@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    try {
      await createInvitation({
        accountId: ids.accountA.id,
        actorUserId: ids.accountA.userId,
        email: "fourth@a.example.test",
        role: "member",
        accountPlanTier: "starter",
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SeatLimitExceededError);
      const e = err as SeatLimitExceededError;
      expect(e.currentTier).toBe("starter");
      expect(e.maxUsers).toBe(TIER_DEFINITIONS.starter.limits.maxUsers);
      expect(e.currentUsers).toBe(1); // just the owner
      expect(e.pendingInvitations).toBe(2);
      expect(e.message).toMatch(/Starter/i);
      expect(e.message).toMatch(/3 seats/);
    }
  });

  it("does not leak across accounts (A's invites don't count toward B's cap)", async () => {
    await setAccountTier(ids.accountA.id, "starter");
    await setAccountTier(ids.accountB.id, "starter");

    // Fill A to the cap.
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "a2@example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "a3@example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // B should still have full cap (1 owner + 0 pending).
    await expect(
      createInvitation({
        accountId: ids.accountB.id,
        actorUserId: ids.accountB.userId,
        email: "b2@example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).resolves.toBeDefined();
    await expect(
      createInvitation({
        accountId: ids.accountB.id,
        actorUserId: ids.accountB.userId,
        email: "b3@example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).resolves.toBeDefined();

    // B at cap now.
    await expect(
      createInvitation({
        accountId: ids.accountB.id,
        actorUserId: ids.accountB.userId,
        email: "b4@example.test",
        role: "member",
        accountPlanTier: "starter",
      })
    ).rejects.toBeInstanceOf(SeatLimitExceededError);
  });
});

describe("countActiveUsers + countPendingInvitations contracts", () => {
  it("countActiveUsers returns the number of seated users for the account", async () => {
    expect(await countActiveUsers(ids.accountA.id)).toBe(1);

    await db.insert(usersTable).values({
      accountId: ids.accountA.id,
      clerkUserId: `clerk_extra_${Date.now()}`,
      workEmail: "extra@a.example.test",
      fullName: "Extra",
      role: "member",
      notificationPrefs: {},
    });
    expect(await countActiveUsers(ids.accountA.id)).toBe(2);
  });

  it("countPendingInvitations excludes accepted + expired invites", async () => {
    await setAccountTier(ids.accountA.id, "starter");

    const fresh = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "fresh@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });
    const willExpire = await createInvitation({
      accountId: ids.accountA.id,
      actorUserId: ids.accountA.userId,
      email: "expired@a.example.test",
      role: "member",
      accountPlanTier: "starter",
    });

    // Expire one.
    await db
      .update(invitationsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitationsTable.id, willExpire.id));

    // Accept the other.
    const [acceptedUser] = await db
      .insert(usersTable)
      .values({
        accountId: ids.accountA.id,
        clerkUserId: `clerk_accepted_${Date.now()}`,
        workEmail: "accepted@a.example.test",
        fullName: "Accepted",
        role: "member",
        notificationPrefs: {},
      })
      .returning();
    if (!acceptedUser) throw new Error("seed failed");
    await db
      .update(invitationsTable)
      .set({ acceptedAt: new Date(), acceptedByUserId: acceptedUser.id })
      .where(eq(invitationsTable.id, fresh.id));

    // Both invites should no longer be pending.
    expect(await countPendingInvitations(ids.accountA.id)).toBe(0);
  });
});
