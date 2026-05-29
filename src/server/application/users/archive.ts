/**
 * User archive — the canonical "remove a user" path.
 *
 * Binding principle (P7.2 / direct user instruction):
 *
 *   A user row is NEVER deleted from the database. When a user is removed
 *   for any reason — Clerk webhook user.deleted, admin removal, account
 *   closure, GDPR erasure request — the row is MOVED to `user_archive`.
 *
 *   - General queries that count active users (seat caps), or list team
 *     members, or resolve the current session, never see archived rows.
 *   - The audit log keeps its FK validity because the archived row retains
 *     its original UUID.
 *   - Future code paths can look up archived users for re-signup detection,
 *     churn analytics, GDPR audit reconstruction, and identity reuse.
 *
 * This module is the ONLY place that calls `db.delete(usersTable)`. The
 * lint + structural-coverage test in P7.3 enforces that.
 *
 * The move is one transaction:
 *
 *   1. Copy users.{id, accountId, clerkUserId, workEmail, fullName, role,
 *      notificationPrefs, createdAt, lastLoginAt} into user_archive +
 *      archival metadata.
 *   2. Remove users.{the_row}.
 *   3. Write an audit_log entry with action = "user.archived" and
 *      before/after snapshots.
 *
 * Idempotency:
 *   - If the row is already absent from `users` AND already present in
 *     `user_archive`, the call is a no-op and returns ok:true.
 *   - If the row is absent from `users` AND absent from `user_archive`,
 *     it's a no-op (the user truly never existed in our DB). Returns ok:true
 *     so retries from Clerk are safe.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  usersArchiveTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { createLogger } from "@server/infrastructure/observability/logger";
import type { User, UserArchive } from "@server/infrastructure/db/schema";

const log = createLogger({ component: "users.archive" });

/**
 * Allowed values for archived_reason. Free-text in the schema for
 * forward compatibility, but the application sets one of these.
 */
export type ArchiveReason =
  | "clerk_user_deleted"
  | "admin_removed"
  | "account_closed"
  | "gdpr_erasure_request"
  | "test_cleanup";

export type ArchiveUserInput = {
  /** UUID of the row in `users`. */
  userId: string;
  /** Why this archive is happening. Required. */
  reason: ArchiveReason;
  /** Admin user performing the archive — null for system/webhook events. */
  archivedByUserId?: string | null;
  /**
   * Free-text note. Required for `gdpr_erasure_request` so the operator
   * records the legal basis / ticket reference; optional otherwise.
   */
  note?: string | null;
};

export type ArchiveUserResult =
  | { ok: true; archived: UserArchive; alreadyArchived: boolean }
  | { ok: false; error: string };

/**
 * Archive a user — the canonical "remove" path.
 *
 * Resolves to ok:true on success OR when the row is already archived
 * (idempotent for webhook retries). Throws only on DB-level errors.
 */
export async function archiveUser(
  input: ArchiveUserInput
): Promise<ArchiveUserResult> {
  if (input.reason === "gdpr_erasure_request" && !input.note?.trim()) {
    return {
      ok: false,
      error:
        "GDPR erasure archives require a note (the ticket reference and legal basis).",
    };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .limit(1);

    if (!existing) {
      // Row already moved (idempotent retry) — surface the archived row
      // so the caller can act on it. If it's not in archive either, it
      // truly never existed; we still return ok:true so a webhook retry
      // doesn't loop on a one-off "user we never saw."
      const [alreadyArchived] = await tx
        .select()
        .from(usersArchiveTable)
        .where(eq(usersArchiveTable.id, input.userId))
        .limit(1);
      if (alreadyArchived) {
        log.info("user_archive_noop_already_archived", {
          userId: input.userId,
        });
        return {
          ok: true as const,
          archived: alreadyArchived,
          alreadyArchived: true,
        };
      }
      log.warn("user_archive_noop_user_never_existed", {
        userId: input.userId,
        reason: input.reason,
      });
      // Synthesize a stub so the caller's audit-log path is happy. We
      // mark archivedAt as now and use the reason as supplied. Not
      // strictly necessary, but the return shape is more useful.
      return {
        ok: true as const,
        archived: {
          id: input.userId,
          accountId: "00000000-0000-0000-0000-000000000000",
          clerkUserId: "",
          workEmail: "",
          fullName: null,
          role: "owner",
          notificationPrefs: {},
          originalCreatedAt: new Date(),
          originalLastLoginAt: null,
          archivedAt: new Date(),
          archivedReason: input.reason,
          archivedByUserId: input.archivedByUserId ?? null,
          archivedNote: input.note ?? null,
        } as UserArchive,
        alreadyArchived: false,
      };
    }

    // Move: insert into archive, then delete from users.
    const [archived] = await tx
      .insert(usersArchiveTable)
      .values({
        id: existing.id,
        accountId: existing.accountId,
        clerkUserId: existing.clerkUserId,
        workEmail: existing.workEmail,
        fullName: existing.fullName,
        role: existing.role,
        notificationPrefs: existing.notificationPrefs,
        originalCreatedAt: existing.createdAt,
        originalLastLoginAt: existing.lastLoginAt,
        archivedAt: new Date(),
        archivedReason: input.reason,
        archivedByUserId: input.archivedByUserId ?? null,
        archivedNote: input.note ?? null,
      })
      .returning();
    if (!archived) {
      throw new Error("user_archive_insert_returned_no_row");
    }

    // The ONLY db.delete(usersTable) call in the codebase. See P7.3 for
    // the structural test that enforces this.
    await tx.delete(usersTable).where(eq(usersTable.id, existing.id));

    await writeAuditLog(tx, {
      accountId: existing.accountId,
      actorUserId: input.archivedByUserId ?? null,
      action: AUDIT_ACTIONS.userArchived,
      target: { entityType: "user", entityId: existing.id },
      before: {
        clerkUserId: existing.clerkUserId,
        workEmail: existing.workEmail,
        role: existing.role,
      },
      after: {
        reason: input.reason,
        archivedAt: archived.archivedAt,
        archivedByUserId: input.archivedByUserId ?? null,
      },
    });

    log.info("user_archived", {
      userId: input.userId,
      accountId: existing.accountId,
      reason: input.reason,
    });

    return { ok: true as const, archived, alreadyArchived: false };
  });
}

/**
 * Look up an archived user by work email. Used by the provisioner to
 * detect re-signups ("welcome back" path) and by the GDPR audit
 * reconstruction tools.
 *
 * Returns null when no archived row matches.
 */
export async function findArchivedUserByEmail(
  workEmail: string
): Promise<UserArchive | null> {
  const normalized = workEmail.trim().toLowerCase();
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(usersArchiveTable)
    .where(eq(usersArchiveTable.workEmail, normalized))
    .limit(1);
  return row ?? null;
}

/**
 * Look up an archived user by their original Clerk user ID. Used by the
 * Clerk webhook idempotency path — if Clerk re-delivers `user.deleted`
 * for an already-archived row, this returns the archive so the caller
 * can ack cleanly.
 */
export async function findArchivedUserByClerkId(
  clerkUserId: string
): Promise<UserArchive | null> {
  if (!clerkUserId) return null;
  const [row] = await db
    .select()
    .from(usersArchiveTable)
    .where(eq(usersArchiveTable.clerkUserId, clerkUserId))
    .limit(1);
  return row ?? null;
}

/**
 * Restore an archived user back into `users`. Used by the re-signup
 * recovery path — when the same person signs up again with the same
 * email, an admin can restore their original membership instead of
 * provisioning a fresh row.
 *
 * Resolves to ok:false when the archived row doesn't exist or the
 * destination has a conflict (e.g. the same email is already active
 * in another row).
 */
export async function restoreArchivedUser(input: {
  archivedUserId: string;
  /** New Clerk identity if the original is gone. */
  newClerkUserId?: string;
  /** Admin user performing the restore. */
  restoredByUserId: string;
}): Promise<
  | { ok: true; user: User }
  | { ok: false; error: string }
> {
  return db.transaction(async (tx) => {
    const [archived] = await tx
      .select()
      .from(usersArchiveTable)
      .where(eq(usersArchiveTable.id, input.archivedUserId))
      .limit(1);
    if (!archived) {
      return { ok: false as const, error: "Archived user not found" };
    }

    // Refuse restoration when the email is already active on the same
    // account (would violate the `(accountId, workEmail)` unique index).
    const [conflict] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.accountId, archived.accountId),
          eq(usersTable.workEmail, archived.workEmail)
        )
      )
      .limit(1);
    if (conflict) {
      return {
        ok: false as const,
        error:
          "Cannot restore: an active user already exists with this email on the account.",
      };
    }

    const [restored] = await tx
      .insert(usersTable)
      .values({
        id: archived.id, // same UUID so audit-log FKs still resolve
        accountId: archived.accountId,
        clerkUserId: input.newClerkUserId ?? archived.clerkUserId,
        workEmail: archived.workEmail,
        fullName: archived.fullName,
        role: archived.role,
        notificationPrefs: archived.notificationPrefs as Record<
          string,
          unknown
        >,
      })
      .returning();
    if (!restored) {
      throw new Error("user_restore_insert_returned_no_row");
    }

    // Remove from archive — restoration completes the round-trip. The
    // audit log preserves the history of both the archive and the
    // restore via the writeAuditLog calls.
    await tx
      .delete(usersArchiveTable)
      .where(eq(usersArchiveTable.id, archived.id));

    await writeAuditLog(tx, {
      accountId: archived.accountId,
      actorUserId: input.restoredByUserId,
      action: AUDIT_ACTIONS.userRestored,
      target: { entityType: "user", entityId: archived.id },
      before: {
        archivedReason: archived.archivedReason,
        archivedAt: archived.archivedAt,
      },
      after: {
        restoredAt: new Date(),
        newClerkUserId: input.newClerkUserId ?? archived.clerkUserId,
      },
    });

    log.info("user_restored", {
      userId: archived.id,
      accountId: archived.accountId,
    });

    return { ok: true as const, user: restored };
  });
}
