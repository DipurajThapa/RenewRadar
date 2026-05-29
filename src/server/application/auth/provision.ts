import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable, invitationsTable, usersTable } from "@server/infrastructure/db/schema";
import { normalizeEmailForDedup } from "@server/application/auth/email-normalize";
import { renderWelcomeEmail } from "@server/infrastructure/email/templates/welcome";
import { sendEmail } from "@server/infrastructure/email/client";
import {
  acceptInvitation,
  SeatLimitExceededError,
} from "@server/application/invitations";
import { getInvitationByToken } from "@server/infrastructure/db/repositories/invitations";
import {
  identifyUser,
  recordEvent,
} from "@server/infrastructure/analytics";
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";

/**
 * Called from the Clerk webhook when a new user signs up.
 *
 * Two flows:
 *   1. **Invited.** When `invitationToken` matches a pending invitation
 *      whose email matches the new user's email, the user is linked to the
 *      inviting account with the invited role — no new account is created.
 *      The invitation is marked accepted in the same response.
 *   2. **Self-signup.** No token (or invalid/expired token) → create a fresh
 *      account, new user is `owner`. This is the V1 default behavior.
 *
 * `invitationToken` is passed through from Clerk's sign-up `unsafe_metadata`
 * by the webhook caller; the `/invitations/[token]` accept page seeds it
 * into the sign-up URL query so Clerk forwards it on user.created.
 */
export async function provisionNewUser(input: {
  clerkUserId: string;
  email: string;
  fullName: string | null;
  invitationToken?: string | null;
}): Promise<{
  accountId: string;
  userId: string;
  joinedExistingAccount: boolean;
}> {
  // Attempt the invited path first.
  if (input.invitationToken) {
    const invitation = await getInvitationByToken(input.invitationToken);
    if (
      invitation &&
      invitation.email.toLowerCase() === input.email.toLowerCase()
    ) {
      const joinResult = await db.transaction(async (tx) => {
        // Re-check the seat cap at accept time. Without this, two invitees
        // accepting in parallel could both pass the create-time gate and
        // exceed the plan limit. We pull the account row in the same tx so
        // a parallel plan-downgrade webhook can't slip the check either.
        const [account] = await tx
          .select({
            id: accountsTable.id,
            planTier: accountsTable.planTier,
          })
          .from(accountsTable)
          .where(eq(accountsTable.id, invitation.accountId))
          .limit(1);
        if (!account) {
          throw new Error("Inviting account no longer exists");
        }
        const maxUsers =
          TIER_DEFINITIONS[account.planTier as PlanTier].limits.maxUsers;
        if (Number.isFinite(maxUsers)) {
          const [activeRow] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(usersTable)
            .where(eq(usersTable.accountId, invitation.accountId));
          const activeUsers = activeRow?.count ?? 0;

          // Pending invites that AREN'T this one (this one is about to be
          // accepted and converted to a user row, so it's already counted
          // in the +1 we apply).
          const [pendingRow] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(invitationsTable)
            .where(
              and(
                eq(invitationsTable.accountId, invitation.accountId),
                isNull(invitationsTable.acceptedAt),
                gt(invitationsTable.expiresAt, new Date())
              )
            );
          const pendingInvites = Math.max(
            0,
            (pendingRow?.count ?? 0) - 1 // exclude self
          );

          if (activeUsers + 1 + pendingInvites > maxUsers) {
            throw new SeatLimitExceededError({
              currentUsers: activeUsers,
              pendingInvitations: pendingInvites,
              maxUsers,
              currentTier: account.planTier as PlanTier,
            });
          }
        }

        const [user] = await tx
          .insert(usersTable)
          .values({
            accountId: invitation.accountId,
            clerkUserId: input.clerkUserId,
            workEmail: input.email,
            fullName: input.fullName,
            role: invitation.role,
            notificationPrefs: defaultNotificationPrefs(),
          })
          .returning();
        if (!user) throw new Error("Failed to create user via invitation");
        return { userId: user.id };
      });

      // Mark the invitation accepted (writes its own audit log).
      await acceptInvitation({
        invitationId: invitation.id,
        acceptedByUserId: joinResult.userId,
      });

      // Activation funnel: a user who joined an existing account didn't
      // create one, so we fire `user.signed_up` with joinedExistingAccount=true.
      const ctx = {
        accountId: invitation.accountId,
        userId: joinResult.userId,
      };
      void identifyUser({
        context: ctx,
        traits: {
          email: input.email,
          role: invitation.role,
          joinedExistingAccount: true,
        },
      });
      void recordEvent({
        event: "user.signed_up",
        context: ctx,
        properties: {
          joinedExistingAccount: true,
          inviteFlow: true,
        },
      });

      return {
        accountId: invitation.accountId,
        userId: joinResult.userId,
        joinedExistingAccount: true,
      };
    }
    // Token didn't match or was stale — fall through to self-signup rather
    // than rejecting. The invitee can re-request a fresh invite.
    console.warn(
      "[provision] invitation token did not match a pending invitation;",
      "falling through to self-signup"
    );
  }

  // Free-tier abuse dedup — refuse a Free Forever signup when the
  // normalized email already owns an existing Free Forever account. The
  // audit's M1 finding: `user+1@gmail.com`, `user+2@gmail.com` previously
  // each got 5 free subscriptions.
  //
  // Sample query path: take all existing Free Forever accounts whose
  // billing email's normalized form matches this signup's. We can't
  // normalize in SQL (would need a stored generated column for that), so
  // we fetch the candidate set by domain and post-filter in code.
  const normalized = normalizeEmailForDedup(input.email);
  const candidates = await db
    .select({
      id: accountsTable.id,
      billingEmail: accountsTable.billingEmail,
    })
    .from(accountsTable)
    .where(eq(accountsTable.planTier, "free_forever"));
  const collision = candidates.find(
    (c) => normalizeEmailForDedup(c.billingEmail) === normalized
  );
  if (collision) {
    throw new Error(
      "A Free Forever account already exists for this email. " +
        "Sign in to the existing account, ask the owner to invite you, " +
        "or upgrade to a paid plan to add a second workspace."
    );
  }

  const result = await db.transaction(async (tx) => {
    const [account] = await tx
      .insert(accountsTable)
      .values({
        name: deriveAccountName(input.email),
        billingEmail: input.email,
        planTier: "free_forever",
      })
      .returning();

    if (!account) {
      throw new Error("Failed to create account during provisioning");
    }

    const [user] = await tx
      .insert(usersTable)
      .values({
        accountId: account.id,
        clerkUserId: input.clerkUserId,
        workEmail: input.email,
        fullName: input.fullName,
        role: "owner",
        notificationPrefs: defaultNotificationPrefs(),
      })
      .returning();

    if (!user) {
      throw new Error("Failed to create user during provisioning");
    }

    return { accountId: account.id, userId: user.id };
  });

  // Send welcome email — non-blocking; provisioning succeeds even on email failure
  void sendWelcomeEmail({
    to: input.email,
    fullName: input.fullName ?? input.email.split("@")[0]!,
  });

  // Activation funnel: this is the canonical first event for self-serve users.
  const ctx = { accountId: result.accountId, userId: result.userId };
  void identifyUser({
    context: ctx,
    traits: { email: input.email, role: "owner", joinedExistingAccount: false },
  });
  void recordEvent({
    event: "user.signed_up",
    context: ctx,
    properties: { joinedExistingAccount: false, inviteFlow: false },
  });

  return { ...result, joinedExistingAccount: false };
}

async function sendWelcomeEmail(input: {
  to: string;
  fullName: string;
}): Promise<void> {
  try {
    const html = await renderWelcomeEmail({
      userName: input.fullName,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com",
    });
    await sendEmail({
      to: input.to,
      subject: "Welcome to Renewal Radar",
      html,
    });
  } catch (err) {
    console.error("[provision] welcome email failed:", err);
  }
}

function deriveAccountName(email: string): string {
  const localPart = email.split("@")[0] ?? "Account";
  const domain = email.split("@")[1] ?? "";
  const domainBase = domain.split(".")[0] ?? "";
  // Prefer the domain (more company-shaped) when it's not a generic provider
  const generic = new Set(["gmail", "outlook", "yahoo", "icloud", "hotmail", "proton", "fastmail"]);
  const base = domainBase && !generic.has(domainBase.toLowerCase()) ? domainBase : localPart;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function defaultNotificationPrefs() {
  return {
    notice_window_30: { email: true, in_app: true },
    notice_window_14: { email: true, in_app: true },
    notice_window_7: { email: true, in_app: true },
    notice_window_3: { email: true, in_app: true },
    notice_window_1: { email: true, in_app: true },
    renewal_90: { email: true, in_app: true },
    renewal_60: { email: true, in_app: true },
    renewal_30: { email: true, in_app: true },
    renewal_14: { email: true, in_app: true },
    renewal_7: { email: true, in_app: true },
    renewal_1: { email: true, in_app: true },
    weekly_digest: { email: true, in_app: false },
    monthly_summary: { email: true, in_app: false },
  };
}
