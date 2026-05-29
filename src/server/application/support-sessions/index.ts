/**
 * Support sessions — the security boundary for staff acting on customer
 * accounts (T4.1 concierge onboarding).
 *
 * Invariants:
 *   1. A staff member CAN'T act on a customer account without an active,
 *      non-expired session targeting that exact account.
 *   2. Every session start is audit-logged on the CUSTOMER's account audit
 *      log (`support.session_started`) AND surfaces an in-app notification
 *      to the account's owners so they always know we accessed their data.
 *   3. Sessions auto-expire after `DEFAULT_DURATION_HOURS` (4h). Expired
 *      sessions are treated as ended even if `ended_at` is still null.
 *   4. One active session per staff member at a time. Starting a new session
 *      ends the prior one with `endedReason = 'superseded'`.
 *   5. Every mutation performed during a session must call
 *      `recordSessionMutation` AND write an audit entry with the session
 *      id in the after-blob. `requireActiveSession` is the gate.
 *
 * Staff identity (`staff_user`) is deliberately separate from customer
 * identity (`users`) — see schema comment.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  staffUsersTable,
  supportSessionsTable,
  usersTable,
  type StaffUser,
  type SupportSession,
} from "@server/infrastructure/db/schema";
import {
  AUDIT_ACTIONS,
  writeAuditLog,
} from "@server/infrastructure/audit-log/writer";
import { sendEmail } from "@server/infrastructure/email/client";
import { createLogger } from "@server/infrastructure/observability/logger";

const log = createLogger({ component: "support-sessions" });

/** Default session length. Tunable per-session via `durationHours`. */
export const DEFAULT_DURATION_HOURS = 4;

/** Hard cap so a typo can't grant a multi-day session. */
const MAX_DURATION_HOURS = 12;

export class SupportSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportSessionError";
  }
}

export type StartSessionInput = {
  staffUserId: string;
  accountId: string;
  reason: string;
  durationHours?: number;
};

export type StartSessionResult = {
  session: SupportSession;
  /**
   * IDs of prior active sessions for this staff that were ended as part of
   * starting this one. Surfaced so callers can warn the operator.
   */
  supersededSessionIds: string[];
};

/**
 * Start a new support session for the staff member against the customer
 * account. Idempotently ends any prior active session for the same staff
 * (we keep at most one active session per staff so the audit trail can't
 * fragment).
 */
export async function startSupportSession(
  input: StartSessionInput
): Promise<StartSessionResult> {
  if (!input.reason.trim() || input.reason.trim().length < 4) {
    throw new SupportSessionError(
      "Reason is required (minimum 4 characters) so the customer audit log is meaningful."
    );
  }
  const durationHours = Math.min(
    input.durationHours ?? DEFAULT_DURATION_HOURS,
    MAX_DURATION_HOURS
  );
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new SupportSessionError("Duration must be a positive number of hours.");
  }

  return db.transaction(async (tx) => {
    // Verify staff is active.
    const [staff] = await tx
      .select()
      .from(staffUsersTable)
      .where(eq(staffUsersTable.id, input.staffUserId))
      .limit(1);
    if (!staff || !staff.active) {
      throw new SupportSessionError(
        "Staff identity not found or inactive — cannot open a session."
      );
    }

    // Verify account exists.
    const [account] = await tx
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, input.accountId))
      .limit(1);
    if (!account) {
      throw new SupportSessionError("Customer account not found.");
    }

    // Supersede any prior active session for this staff so there's exactly
    // one active session at a time per staff member.
    const supersededSessionIds: string[] = [];
    const priorActive = await tx
      .select({ id: supportSessionsTable.id })
      .from(supportSessionsTable)
      .where(
        and(
          eq(supportSessionsTable.staffUserId, input.staffUserId),
          isNull(supportSessionsTable.endedAt)
        )
      );
    for (const prior of priorActive) {
      await tx
        .update(supportSessionsTable)
        .set({
          endedAt: new Date(),
          endedReason: "superseded" as const,
        })
        .where(eq(supportSessionsTable.id, prior.id));
      supersededSessionIds.push(prior.id);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    const [session] = await tx
      .insert(supportSessionsTable)
      .values({
        staffUserId: input.staffUserId,
        accountId: input.accountId,
        reason: input.reason.trim(),
        startedAt: now,
        expiresAt,
      })
      .returning();
    if (!session) {
      throw new SupportSessionError("Failed to create support session.");
    }

    // Customer-side audit entry — shows up in the customer's audit feed.
    await writeAuditLog(tx, {
      accountId: input.accountId,
      actorUserId: null, // staff actions are tagged via the after-blob
      action: AUDIT_ACTIONS.supportSessionStarted,
      target: { entityType: "account", entityId: input.accountId },
      after: {
        supportSessionId: session.id,
        staffUserId: staff.id,
        staffEmail: staff.email,
        reason: session.reason,
        expiresAt: session.expiresAt.toISOString(),
      },
    });

    // Customer notification — owners/admins MUST learn about this without
    // having to check the audit log themselves. Email is the right channel
    // because customers don't always have the app open. The existing
    // notification table is keyed to renewal triggers (not generic system
    // events) so we email directly rather than wedging support sessions
    // into that taxonomy — keeps the renewal-alerts model unpolluted.
    const recipients = await tx
      .select({ email: usersTable.workEmail, fullName: usersTable.fullName })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.accountId, input.accountId),
          or(eq(usersTable.role, "owner"), eq(usersTable.role, "admin"))
        )
      );
    const recipientEmails = recipients.map((r) => r.email);
    // Send after the tx commits — keep the transaction tight. The session is
    // already audit-logged; an email failure won't roll back the session.
    queueMicrotask(() => {
      if (recipientEmails.length === 0) return;
      void sendEmail({
        to: recipientEmails,
        subject: "Renewal Radar support has accessed your account",
        html: renderSupportStartedEmail({
          staffName: staff.fullName ?? staff.email,
          staffEmail: staff.email,
          reason: session.reason,
          durationHours,
          accountName: account.name,
        }),
      }).catch((err) => {
        log.error("support_started_email_failed", err, {
          sessionId: session.id,
          recipientCount: recipientEmails.length,
        });
      });
    });

    log.info("support_session_started", {
      sessionId: session.id,
      staffUserId: staff.id,
      staffEmail: staff.email,
      accountId: input.accountId,
      reason: session.reason,
      durationHours,
      supersededCount: supersededSessionIds.length,
    });

    return { session, supersededSessionIds };
  });
}

/**
 * End a session manually (the staff explicitly logs out) or by timeout
 * (the cron job catches expired sessions).
 */
export async function endSupportSession(
  sessionId: string,
  reason: "manual" | "timeout"
): Promise<SupportSession | null> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(supportSessionsTable)
      .where(eq(supportSessionsTable.id, sessionId))
      .limit(1);
    if (!session) return null;
    if (session.endedAt) return session; // idempotent

    const [updated] = await tx
      .update(supportSessionsTable)
      .set({ endedAt: new Date(), endedReason: reason })
      .where(eq(supportSessionsTable.id, sessionId))
      .returning();

    await writeAuditLog(tx, {
      accountId: session.accountId,
      actorUserId: null,
      action: AUDIT_ACTIONS.supportSessionEnded,
      target: { entityType: "account", entityId: session.accountId },
      after: {
        supportSessionId: session.id,
        staffUserId: session.staffUserId,
        endedReason: reason,
        mutationCount: session.mutationCount,
      },
    });

    return updated ?? null;
  });
}

/**
 * Get the active session for a staff member, if any. Returns null if there
 * is no session or the session is past its expiry (we auto-end on read).
 */
export async function getActiveSupportSession(
  staffUserId: string
): Promise<SupportSession | null> {
  const [session] = await db
    .select()
    .from(supportSessionsTable)
    .where(
      and(
        eq(supportSessionsTable.staffUserId, staffUserId),
        isNull(supportSessionsTable.endedAt)
      )
    )
    .limit(1);
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await endSupportSession(session.id, "timeout");
    return null;
  }
  return session;
}

/**
 * Gate for staff actions. Throws when:
 *   - No active session for the staff member
 *   - The active session targets a different account
 *
 * On success: increments the session's mutation counter and writes a
 * `staff_acted` audit entry with the action description in the after-blob.
 *
 * Use as the FIRST line of every staff-on-behalf action.
 */
export async function requireActiveSession(args: {
  staffUserId: string;
  accountId: string;
  action: string;
}): Promise<SupportSession> {
  const session = await getActiveSupportSession(args.staffUserId);
  if (!session) {
    throw new SupportSessionError(
      "No active support session — start one before acting on an account."
    );
  }
  if (session.accountId !== args.accountId) {
    throw new SupportSessionError(
      "Active session targets a different account. End it first and start a new one for this account."
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(supportSessionsTable)
      .set({ mutationCount: sql`${supportSessionsTable.mutationCount} + 1` })
      .where(eq(supportSessionsTable.id, session.id));

    const [staff] = await tx
      .select({ id: staffUsersTable.id, email: staffUsersTable.email })
      .from(staffUsersTable)
      .where(eq(staffUsersTable.id, session.staffUserId))
      .limit(1);

    await writeAuditLog(tx, {
      accountId: session.accountId,
      actorUserId: null,
      action: AUDIT_ACTIONS.staffActedOnAccount,
      target: { entityType: "account", entityId: session.accountId },
      after: {
        supportSessionId: session.id,
        staffUserId: session.staffUserId,
        staffEmail: staff?.email ?? null,
        action: args.action,
      },
    });
  });

  return session;
}

/**
 * Auto-provision a staff_user row from a Clerk identity. Returns the
 * existing row if email matches; creates a new one otherwise. Only called
 * by the staff middleware after verifying the email matches `STAFF_EMAILS`.
 */
export async function ensureStaffUser(input: {
  clerkUserId: string | null;
  email: string;
  fullName?: string | null;
}): Promise<StaffUser> {
  const normalized = input.email.trim().toLowerCase();
  if (!normalized) {
    throw new SupportSessionError("Cannot provision staff without an email.");
  }
  const [existing] = await db
    .select()
    .from(staffUsersTable)
    .where(eq(staffUsersTable.email, normalized))
    .limit(1);
  if (existing) {
    // Update clerkUserId + lastLoginAt on each call — staff sometimes
    // re-auth after Clerk session resets.
    const [updated] = await db
      .update(staffUsersTable)
      .set({
        clerkUserId: input.clerkUserId ?? existing.clerkUserId,
        lastLoginAt: new Date(),
      })
      .where(eq(staffUsersTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await db
    .insert(staffUsersTable)
    .values({
      clerkUserId: input.clerkUserId,
      email: normalized,
      fullName: input.fullName ?? null,
      role: "support" as const,
      lastLoginAt: new Date(),
    })
    .returning();
  if (!created) {
    throw new SupportSessionError("Failed to provision staff user.");
  }
  return created;
}

/**
 * Minimal HTML email body for "support has accessed your account". Plain
 * inline-style template — keeps the deploy lean (no MJX dependency for
 * one staff-rare message).
 */
function renderSupportStartedEmail(args: {
  staffName: string;
  staffEmail: string;
  reason: string;
  durationHours: number;
  accountName: string;
}): string {
  const safe = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 24px auto; color: #1a1a1a; line-height: 1.6;">
  <h2 style="margin: 0 0 12px;">Support is assisting with ${safe(args.accountName)}</h2>
  <p>
    ${safe(args.staffName)} (${safe(args.staffEmail)}) from Renewal Radar
    started a support session on your account.
  </p>
  <p style="background: #f6f7f9; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
    <strong>Reason:</strong> ${safe(args.reason)}<br/>
    <strong>Auto-expires:</strong> in ${args.durationHours} hour${args.durationHours === 1 ? "" : "s"}
  </p>
  <p>
    Every action they take is logged to your account&apos;s audit trail
    (Settings → Audit). If you didn&apos;t expect this, reply to this email
    or revoke support access from your account settings.
  </p>
  <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
    Renewal Radar sends this whenever a staff member accesses customer data.
  </p>
</body></html>`;
}
