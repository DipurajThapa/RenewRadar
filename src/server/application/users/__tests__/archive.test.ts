/**
 * archiveUser + restoreArchivedUser + archive lookups — the canonical
 * "remove a user" path.
 *
 * Covers:
 *   - Archive moves the row (users → user_archive) preserving id + data
 *   - audit_log gets a "user.archived" entry
 *   - Idempotency: re-archiving a missing user is a no-op
 *   - GDPR erasure requires a note (legal-basis safety check)
 *   - findArchivedUserByEmail returns the archived row
 *   - findArchivedUserByClerkId returns the archived row
 *   - restoreArchivedUser brings the row back into users with same id
 *   - Restore refuses when an active user already has the email
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  usersArchiveTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import {
  archiveUser,
  findArchivedUserByClerkId,
  findArchivedUserByEmail,
  restoreArchivedUser,
} from "@server/application/users/archive";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();
});

// ─────────────────────────────────────────────────────────────────────────
// archive: happy path + data preservation
// ─────────────────────────────────────────────────────────────────────────

describe("archiveUser", () => {
  it("moves the row from users to user_archive, preserving the UUID", async () => {
    const result = await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Row no longer in users.
    const usersRows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ids.accountA.userId));
    expect(usersRows.length).toBe(0);

    // Row IS in archive with same UUID + same data.
    const archived = await db
      .select()
      .from(usersArchiveTable)
      .where(eq(usersArchiveTable.id, ids.accountA.userId));
    expect(archived.length).toBe(1);
    expect(archived[0]?.workEmail).toBe("owner@a.example.test");
    expect(archived[0]?.archivedReason).toBe("clerk_user_deleted");
  });

  it("writes a user.archived audit log entry", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    const auditRows = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "user.archived"));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0]?.accountId).toBe(ids.accountA.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// archive: idempotency + edge cases
// ─────────────────────────────────────────────────────────────────────────

describe("archiveUser idempotency", () => {
  it("re-archiving an already-archived user is a no-op (Clerk webhook retry safety)", async () => {
    const first = await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.alreadyArchived).toBe(false);

    const second = await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyArchived).toBe(true);
    expect(second.archived.id).toBe(ids.accountA.userId);
  });

  it("archiving a never-existed userId is a soft no-op (returns ok:true)", async () => {
    const r = await archiveUser({
      userId: "00000000-0000-0000-0000-000000000001",
      reason: "clerk_user_deleted",
    });
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// archive: GDPR safety check
// ─────────────────────────────────────────────────────────────────────────

describe("archiveUser GDPR erasure requires a note", () => {
  it("refuses gdpr_erasure_request without a note", async () => {
    const r = await archiveUser({
      userId: ids.accountA.userId,
      reason: "gdpr_erasure_request",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/note/i);
  });

  it("accepts gdpr_erasure_request with a note", async () => {
    const r = await archiveUser({
      userId: ids.accountA.userId,
      reason: "gdpr_erasure_request",
      note: "Ticket #1234 — DSAR from data subject 2026-05-29",
    });
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// lookups
// ─────────────────────────────────────────────────────────────────────────

describe("archive lookups", () => {
  it("findArchivedUserByEmail returns the archived row", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "admin_removed",
    });
    const found = await findArchivedUserByEmail("owner@a.example.test");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(ids.accountA.userId);
  });

  it("findArchivedUserByEmail returns null for unknown email", async () => {
    expect(await findArchivedUserByEmail("nobody@nowhere.test")).toBeNull();
  });

  it("findArchivedUserByClerkId returns the archived row", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    // The seed uses `clerk_a_${a.id}` as clerkUserId.
    const found = await findArchivedUserByClerkId(`clerk_a_${ids.accountA.id}`);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(ids.accountA.userId);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// restoreArchivedUser
// ─────────────────────────────────────────────────────────────────────────

describe("restoreArchivedUser", () => {
  it("brings the archived row back into users with the SAME UUID", async () => {
    // Archive A's owner.
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    // Restore via account B's user (any admin actor).
    const r = await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.user.id).toBe(ids.accountA.userId);

    // user_archive no longer holds the row.
    const archived = await db
      .select()
      .from(usersArchiveTable)
      .where(eq(usersArchiveTable.id, ids.accountA.userId));
    expect(archived.length).toBe(0);
  });

  it("refuses to restore when the email is already active on the account", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    // Now create a NEW user with the same email on the same account
    // (simulating "the team re-seated the email under a different Clerk
    // identity").
    await db.insert(usersTable).values({
      accountId: ids.accountA.id,
      clerkUserId: `clerk_new_${Date.now()}`,
      workEmail: "owner@a.example.test",
      fullName: "Replacement Owner",
      role: "owner",
      notificationPrefs: {},
    });

    const r = await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/already exists/i);
  });

  it("returns ok:false when the archived row doesn't exist", async () => {
    const r = await restoreArchivedUser({
      archivedUserId: "00000000-0000-0000-0000-000000000002",
      restoredByUserId: ids.accountB.userId,
    });
    expect(r.ok).toBe(false);
  });
});
