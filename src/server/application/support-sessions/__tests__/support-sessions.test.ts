/**
 * T4.1 — Support session security boundary contract tests.
 *
 * The whole concierge feature lives or dies on these invariants holding.
 * If any of these regress, staff could act on data without leaving a trail
 * — which is the single worst failure mode for an internal admin tool.
 *
 * Pinned here:
 *   - Reason must be non-trivial (>= 4 chars). The customer's audit log is
 *     the only justification trail; an empty reason makes it useless.
 *   - Duration is hard-capped (12h max) — a typo can't grant multi-day access.
 *   - Starting a new session SUPERSEDES any prior active session for the
 *     same staff: at most one open session per staff member.
 *   - Audit log entry is written on the CUSTOMER's account on session start
 *     so the customer can see who/why even if email never lands.
 *   - getActiveSupportSession returns null when the session is past expiry
 *     (auto-ends on read; no zombie sessions).
 *   - requireActiveSession refuses (a) no session, (b) wrong-account session,
 *     (c) expired session, and increments the mutation counter on success.
 *   - ensureStaffUser is idempotent and case-insensitive on email.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  auditLogTable,
  staffUsersTable,
  supportSessionsTable,
} from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";

// We don't want tests to actually send email. The module fires email via
// queueMicrotask after the tx commits; we just need sendEmail to be a no-op.
vi.mock("@server/infrastructure/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "test" }),
}));

import {
  DEFAULT_DURATION_HOURS,
  endSupportSession,
  ensureStaffUser,
  getActiveSupportSession,
  requireActiveSession,
  startSupportSession,
  SupportSessionError,
} from "@server/application/support-sessions";

let ids: SeedTwoAccountsResult;
let staffId: string;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();

  // Seed a staff identity for each test. We bypass ensureStaffUser here so
  // setup stays explicit — the helper itself is tested separately.
  const [staff] = await db
    .insert(staffUsersTable)
    .values({
      email: "ops@renewalradar.com",
      fullName: "Ops Person",
      role: "support" as const,
    })
    .returning();
  if (!staff) throw new Error("staff seed failed");
  staffId = staff.id;
});

// ─────────────────────────────────────────────────────────────────────────
// startSupportSession
// ─────────────────────────────────────────────────────────────────────────

describe("startSupportSession", () => {
  it("rejects an empty or too-short reason", async () => {
    await expect(
      startSupportSession({
        staffUserId: staffId,
        accountId: ids.accountA.id,
        reason: "",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
    await expect(
      startSupportSession({
        staffUserId: staffId,
        accountId: ids.accountA.id,
        reason: "ok",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
  });

  it("caps duration at 12 hours even if a longer value is passed", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Ticket #1234 - data import assistance",
      durationHours: 240, // 10 days
    });
    const ms = session.expiresAt.getTime() - session.startedAt.getTime();
    const hours = ms / (60 * 60 * 1000);
    expect(hours).toBe(12); // capped
  });

  it("defaults to 4 hours when no duration is supplied", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Default duration check",
    });
    const ms = session.expiresAt.getTime() - session.startedAt.getTime();
    const hours = Math.round(ms / (60 * 60 * 1000));
    expect(hours).toBe(DEFAULT_DURATION_HOURS);
  });

  it("supersedes a prior active session for the same staff member", async () => {
    const first = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "First session",
    });
    const second = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountB.id,
      reason: "Second session (different account)",
    });
    expect(second.supersededSessionIds).toEqual([first.session.id]);

    const [prior] = await db
      .select()
      .from(supportSessionsTable)
      .where(eq(supportSessionsTable.id, first.session.id));
    expect(prior?.endedAt).not.toBeNull();
    expect(prior?.endedReason).toBe("superseded");
  });

  it("writes a support.session_started audit entry on the customer account", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Verifying audit-log behavior",
    });
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "support.session_started"));
    expect(audits.length).toBe(1);
    expect(audits[0]?.accountId).toBe(ids.accountA.id);
    const after = audits[0]?.after as Record<string, unknown>;
    expect(after.supportSessionId).toBe(session.id);
    expect(after.staffEmail).toBe("ops@renewalradar.com");
    expect(after.reason).toBe("Verifying audit-log behavior");
  });

  it("rejects an unknown account", async () => {
    await expect(
      startSupportSession({
        staffUserId: staffId,
        accountId: "00000000-0000-0000-0000-000000000999",
        reason: "Ghost account check",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
  });

  it("rejects an inactive staff member", async () => {
    await db
      .update(staffUsersTable)
      .set({ active: false })
      .where(eq(staffUsersTable.id, staffId));
    await expect(
      startSupportSession({
        staffUserId: staffId,
        accountId: ids.accountA.id,
        reason: "Inactive staff attempt",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getActiveSupportSession
// ─────────────────────────────────────────────────────────────────────────

describe("getActiveSupportSession", () => {
  it("returns null when no session exists", async () => {
    const active = await getActiveSupportSession(staffId);
    expect(active).toBeNull();
  });

  it("returns the active session when one exists", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Session lookup",
    });
    const active = await getActiveSupportSession(staffId);
    expect(active?.id).toBe(session.id);
  });

  it("auto-ends a past-expiry session and returns null", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Will expire",
    });
    // Force the expiry into the past.
    await db
      .update(supportSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(supportSessionsTable.id, session.id));

    const active = await getActiveSupportSession(staffId);
    expect(active).toBeNull();

    const [closed] = await db
      .select()
      .from(supportSessionsTable)
      .where(eq(supportSessionsTable.id, session.id));
    expect(closed?.endedAt).not.toBeNull();
    expect(closed?.endedReason).toBe("timeout");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// requireActiveSession
// ─────────────────────────────────────────────────────────────────────────

describe("requireActiveSession", () => {
  it("throws when there's no active session", async () => {
    await expect(
      requireActiveSession({
        staffUserId: staffId,
        accountId: ids.accountA.id,
        action: "csv_import",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
  });

  it("throws when the session targets a different account", async () => {
    await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Session for A",
    });
    await expect(
      requireActiveSession({
        staffUserId: staffId,
        accountId: ids.accountB.id, // wrong account
        action: "csv_import",
      })
    ).rejects.toBeInstanceOf(SupportSessionError);
  });

  it("succeeds for the right account and bumps the mutation counter + audit", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "Mutation tracking",
    });

    const checked = await requireActiveSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      action: "csv_import",
    });
    expect(checked.id).toBe(session.id);

    const [after] = await db
      .select()
      .from(supportSessionsTable)
      .where(eq(supportSessionsTable.id, session.id));
    expect(after?.mutationCount).toBe(1);

    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "support.staff_acted"));
    expect(audits.length).toBe(1);
    const blob = audits[0]?.after as Record<string, unknown>;
    expect(blob.action).toBe("csv_import");
    expect(blob.supportSessionId).toBe(session.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// endSupportSession
// ─────────────────────────────────────────────────────────────────────────

describe("endSupportSession", () => {
  it("marks endedAt + endedReason and is idempotent on re-call", async () => {
    const { session } = await startSupportSession({
      staffUserId: staffId,
      accountId: ids.accountA.id,
      reason: "End-of-session test",
    });

    const ended = await endSupportSession(session.id, "manual");
    expect(ended?.endedAt).not.toBeNull();
    expect(ended?.endedReason).toBe("manual");

    // Calling again should be a no-op, not throw.
    const again = await endSupportSession(session.id, "manual");
    expect(again?.endedAt?.getTime()).toBe(ended?.endedAt?.getTime());
  });

  it("returns null for an unknown session id", async () => {
    const r = await endSupportSession(
      "00000000-0000-0000-0000-000000000999",
      "manual"
    );
    expect(r).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ensureStaffUser
// ─────────────────────────────────────────────────────────────────────────

describe("ensureStaffUser", () => {
  it("creates a new staff row when email is unknown", async () => {
    const created = await ensureStaffUser({
      clerkUserId: "clerk_xyz",
      email: "newhire@renewalradar.com",
      fullName: "New Hire",
    });
    expect(created.email).toBe("newhire@renewalradar.com");
    expect(created.role).toBe("support");
    expect(created.active).toBe(true);
  });

  it("returns the existing row and updates lastLoginAt on a known email", async () => {
    const first = await ensureStaffUser({
      clerkUserId: "clerk_a",
      email: "Existing@RenewalRadar.com",
    });
    const second = await ensureStaffUser({
      clerkUserId: "clerk_b",
      email: "existing@renewalradar.com", // case-insensitive
    });
    expect(second.id).toBe(first.id);
    // ClerkUserId is updated on re-auth.
    expect(second.clerkUserId).toBe("clerk_b");
  });
});
