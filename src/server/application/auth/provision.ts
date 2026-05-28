import { db } from "@server/infrastructure/db/client";
import { accountsTable, invitationsTable, usersTable } from "@server/infrastructure/db/schema";
import { renderWelcomeEmail } from "@server/infrastructure/email/templates/welcome";
import { sendEmail } from "@server/infrastructure/email/client";
import { acceptInvitation } from "@server/application/invitations";
import { getInvitationByToken } from "@server/infrastructure/db/repositories/invitations";

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

  return { ...result, joinedExistingAccount: false };
}

// invitationsTable reference kept so a future SCIM provisioner can reuse
// the import; explicitly silenced to satisfy strict unused-export checks.
void invitationsTable;

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
