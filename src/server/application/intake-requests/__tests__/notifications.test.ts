/**
 * T4.11.x — Intake notification fan-out contract tests.
 *
 * Invariants:
 *   - SUBMITTED notifies only approvers (owners + admins), never the
 *     requester themselves, never members/viewers.
 *   - DECIDED notifies only the original requester.
 *   - Both email + in-app rows are written (channel default is both-on),
 *     deduped by the (user, trigger, entity, channel) unique constraint.
 *   - A recipient who muted a channel for the trigger doesn't get that row.
 *   - Tenant scope: account B's approvers never get account A's request.
 *
 * Email is a no-op in tests (no RESEND_API_KEY) — the email row is still
 * created and we assert on its presence, not on delivery.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  intakeRequestsTable,
  notificationsTable,
  usersTable,
  type IntakeRequest,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  notifyIntakeDecision,
  notifyIntakeSubmitted,
} from "@server/application/intake-requests/notifications";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

type Seed = {
  accountId: string;
  ownerId: string;
  adminId: string;
  memberId: string;
  viewerId: string;
  request: IntakeRequest;
};

/**
 * Seed one account with one of each role. The request is submitted by the
 * member. Returns the ids + the inserted intake request row.
 */
async function seed(opts?: { requesterRole?: "member" | "admin" }): Promise<Seed> {
  const [account] = await db
    .insert(accountsTable)
    .values({ name: "Acme", billingEmail: "billing@acme.test" })
    .returning();
  if (!account) throw new Error("seed account failed");

  async function user(role: "owner" | "admin" | "member" | "viewer", email: string) {
    const [u] = await db
      .insert(usersTable)
      .values({
        accountId: account!.id,
        clerkUserId: `clerk_${role}_${account!.id}`,
        workEmail: email,
        fullName: role.toUpperCase(),
        role,
      })
      .returning();
    if (!u) throw new Error(`seed ${role} failed`);
    return u;
  }

  const owner = await user("owner", "owner@acme.test");
  const admin = await user("admin", "admin@acme.test");
  const member = await user("member", "member@acme.test");
  const viewer = await user("viewer", "viewer@acme.test");

  const requesterId = opts?.requesterRole === "admin" ? admin.id : member.id;

  const [request] = await db
    .insert(intakeRequestsTable)
    .values({
      accountId: account.id,
      requesterUserId: requesterId,
      vendor: "Linear",
      product: "Standard",
      businessCase: "Engineering needs Linear to replace Jira for sprint planning.",
      estimatedAnnualUsdCents: 12_000_00,
    })
    .returning();
  if (!request) throw new Error("seed request failed");

  return {
    accountId: account.id,
    ownerId: owner.id,
    adminId: admin.id,
    memberId: member.id,
    viewerId: viewer.id,
    request,
  };
}

async function rowsFor(userId: string, trigger: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.trigger, trigger as never)
      )
    );
}

describe("notifyIntakeSubmitted", () => {
  it("notifies owners + admins, not the requester, members, or viewers", async () => {
    const s = await seed();
    const result = await notifyIntakeSubmitted({
      request: s.request,
      requesterName: "MEMBER",
    });

    // owner + admin = 2 (member is the requester; viewer is excluded by role)
    expect(result.recipientCount).toBe(2);

    // owner + admin each get email + in_app rows
    expect(await rowsFor(s.ownerId, "intake_request_submitted")).toHaveLength(2);
    expect(await rowsFor(s.adminId, "intake_request_submitted")).toHaveLength(2);
    // requester (member) and viewer get nothing
    expect(await rowsFor(s.memberId, "intake_request_submitted")).toHaveLength(0);
    expect(await rowsFor(s.viewerId, "intake_request_submitted")).toHaveLength(0);
  });

  it("excludes the requester even when they are an admin/owner", async () => {
    const s = await seed({ requesterRole: "admin" });
    const result = await notifyIntakeSubmitted({
      request: s.request,
      requesterName: "ADMIN",
    });
    // requester is the admin → only the owner is notified
    expect(result.recipientCount).toBe(1);
    expect(await rowsFor(s.ownerId, "intake_request_submitted")).toHaveLength(2);
    expect(await rowsFor(s.adminId, "intake_request_submitted")).toHaveLength(0);
  });

  it("is idempotent — a second call does not create duplicate rows", async () => {
    const s = await seed();
    await notifyIntakeSubmitted({ request: s.request, requesterName: "MEMBER" });
    await notifyIntakeSubmitted({ request: s.request, requesterName: "MEMBER" });
    // still exactly 2 (email + in_app), not 4
    expect(await rowsFor(s.ownerId, "intake_request_submitted")).toHaveLength(2);
  });

  it("writes an in-app row with a renderable payload", async () => {
    const s = await seed();
    await notifyIntakeSubmitted({ request: s.request, requesterName: "MEMBER" });
    const [inApp] = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, s.ownerId),
          eq(notificationsTable.channel, "in_app"),
          eq(notificationsTable.trigger, "intake_request_submitted" as never)
        )
      );
    expect(inApp?.entityType).toBe("intake_request");
    expect(inApp?.entityId).toBe(s.request.id);
    const payload = inApp?.payload as Record<string, unknown> | null;
    expect(payload?.vendor).toBe("Linear");
    expect(payload?.product).toBe("Standard");
  });

  it("respects a muted email channel preference", async () => {
    const s = await seed();
    // Owner mutes email for this trigger (keeps in_app on).
    await db
      .update(usersTable)
      .set({
        notificationPrefs: {
          intake_request_submitted: { email: false, in_app: true },
        },
      })
      .where(eq(usersTable.id, s.ownerId));

    await notifyIntakeSubmitted({ request: s.request, requesterName: "MEMBER" });

    const ownerRows = await rowsFor(s.ownerId, "intake_request_submitted");
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.channel).toBe("in_app");
    // admin (no pref override) still gets both
    expect(await rowsFor(s.adminId, "intake_request_submitted")).toHaveLength(2);
  });

  it("does not notify another account's approvers (tenant scope)", async () => {
    const a = await seed();
    const b = await seed();
    await notifyIntakeSubmitted({ request: a.request, requesterName: "MEMBER" });
    // account B's owner got nothing from account A's request
    expect(await rowsFor(b.ownerId, "intake_request_submitted")).toHaveLength(0);
  });
});

describe("notifyIntakeDecision", () => {
  it("notifies the requester (email + in_app) and no one else", async () => {
    const s = await seed();
    const result = await notifyIntakeDecision({
      request: s.request,
      decision: "approved",
    });
    expect(result.reached).toBe(true);

    expect(await rowsFor(s.memberId, "intake_request_decided")).toHaveLength(2);
    // approvers do not get the decision notice
    expect(await rowsFor(s.ownerId, "intake_request_decided")).toHaveLength(0);
    expect(await rowsFor(s.adminId, "intake_request_decided")).toHaveLength(0);
  });

  it("carries the decision + reviewer note in the in-app payload", async () => {
    const s = await seed();
    // attach a reviewer note to the in-memory row we pass in
    const request = { ...s.request, reviewerNote: "Out of budget this quarter." };
    await notifyIntakeDecision({ request, decision: "denied" });

    const [inApp] = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, s.memberId),
          eq(notificationsTable.channel, "in_app"),
          eq(notificationsTable.trigger, "intake_request_decided" as never)
        )
      );
    const payload = inApp?.payload as Record<string, unknown> | null;
    expect(payload?.decision).toBe("denied");
    expect(payload?.reviewerNote).toBe("Out of budget this quarter.");
  });

  it("is idempotent for the same request", async () => {
    const s = await seed();
    await notifyIntakeDecision({ request: s.request, decision: "approved" });
    await notifyIntakeDecision({ request: s.request, decision: "approved" });
    expect(await rowsFor(s.memberId, "intake_request_decided")).toHaveLength(2);
  });
});
