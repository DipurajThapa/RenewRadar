/**
 * Archive flow edge cases — the production failure modes.
 *
 * The "never delete users" architecture (P7.2) holds only if these
 * production realities are handled correctly:
 *
 *   - Clerk webhook re-delivery (user.deleted twice for the same user)
 *   - Clerk webhook for a user we never provisioned (clerk-side delete of
 *     a row that failed to write on our side)
 *   - Audit-log lineage preservation across archive → restore round-trip
 *   - Cross-account scoping — A's archive must never bleed into B's lookups
 *
 * archive.test.ts already covers the happy path. This file pins the
 * production-realistic stress cases.
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
// Clerk webhook idempotency
// ─────────────────────────────────────────────────────────────────────────

describe("Clerk webhook user.deleted re-delivery", () => {
  it("does NOT write a second audit-log entry on re-delivery", async () => {
    // First delivery — the archive write + audit entry should land.
    const first = await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    expect(first.ok).toBe(true);

    // Second delivery (Clerk re-fired the webhook) — no-op.
    const second = await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyArchived).toBe(true);

    // Audit log must show exactly ONE archive entry, not two. Otherwise
    // retention math + the investor-facing audit history are wrong.
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "user.archived"));
    expect(audits.length).toBe(1);
  });

  it("treats clerk_user_deleted for a never-provisioned user as ok:true", async () => {
    // If Clerk delivers user.deleted for a Clerk user we never wrote to
    // our DB (e.g. provisioning failed earlier and webhook retried), the
    // archive call must NOT raise — otherwise the webhook would 5xx in a
    // loop. archiveUser returns ok:true so Clerk acks and stops retrying.
    const result = await archiveUser({
      userId: "00000000-0000-0000-0000-aaaaaaaaaaaa",
      reason: "clerk_user_deleted",
    });
    expect(result.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Re-signup detection — the whole reason we archive instead of delete
// ─────────────────────────────────────────────────────────────────────────

describe("re-signup discovery", () => {
  it("findArchivedUserByEmail finds the row after archive (welcome-back path)", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    const found = await findArchivedUserByEmail("owner@a.example.test");
    expect(found?.id).toBe(ids.accountA.userId);
    expect(found?.archivedReason).toBe("clerk_user_deleted");
  });

  it("findArchivedUserByEmail normalizes case + whitespace", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    // The query lower-cases + trims; archived rows preserve case, so a
    // user who registered as Owner@A.Example.TEST and is now signing up
    // again as `  owner@a.example.test  ` must be discoverable.
    expect(
      await findArchivedUserByEmail("  Owner@A.Example.TEST  ")
    ).not.toBeNull();
    expect(
      (await findArchivedUserByEmail("  Owner@A.Example.TEST  "))?.id
    ).toBe(ids.accountA.userId);
  });

  it("findArchivedUserByClerkId returns null for unknown clerk id (defensive)", async () => {
    expect(await findArchivedUserByClerkId("clerk_does_not_exist")).toBeNull();
    expect(await findArchivedUserByClerkId("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Restore round-trip — same UUID, audit lineage preserved
// ─────────────────────────────────────────────────────────────────────────

describe("archive → restore round-trip preserves audit lineage", () => {
  it("emits exactly one archive entry and one restore entry, same target id", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });

    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.targetEntityId, ids.accountA.userId));
    const actions = audits.map((a) => a.action).sort();
    expect(actions).toEqual(["user.archived", "user.restored"]);
    // FK integrity — both audits resolve back to the SAME user row, now
    // re-active in `users` after restore.
    const [restored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ids.accountA.userId));
    expect(restored).toBeDefined();
  });

  it("removes the row from user_archive on successful restore", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "admin_removed",
    });
    await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });
    const archived = await db
      .select()
      .from(usersArchiveTable)
      .where(eq(usersArchiveTable.id, ids.accountA.userId));
    expect(archived.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cross-account scoping — archives must NOT leak across tenants
// ─────────────────────────────────────────────────────────────────────────

describe("archive cross-tenant scoping", () => {
  it("Account A's archive does not appear in Account B's data", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "admin_removed",
    });
    // The archived row belongs to A's accountId. A query scoped to B
    // must not see it.
    const bArchivedRows = await db
      .select()
      .from(usersArchiveTable)
      .where(eq(usersArchiveTable.accountId, ids.accountB.id));
    expect(bArchivedRows.length).toBe(0);

    // And the audit entry should be on A's accountId, not B's.
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "user.archived"));
    expect(audits.every((a) => a.accountId === ids.accountA.id)).toBe(true);
  });

  it("archiving A's user does not remove B's users", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    const bUsers = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.accountId, ids.accountB.id));
    expect(bUsers.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Restore failure modes
// ─────────────────────────────────────────────────────────────────────────

describe("restore failure modes", () => {
  it("returns ok:false when the archive row was already restored", async () => {
    await archiveUser({
      userId: ids.accountA.userId,
      reason: "clerk_user_deleted",
    });
    const first = await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });
    expect(first.ok).toBe(true);

    // Second restore attempt — archive row is gone now.
    const second = await restoreArchivedUser({
      archivedUserId: ids.accountA.userId,
      restoredByUserId: ids.accountB.userId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/not found/i);
  });
});
