"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  createInvitation,
  revokeInvitation,
} from "@server/application/invitations";
import { sendEmail } from "@server/infrastructure/email/client";
import { renderInvitationEmail } from "@server/infrastructure/email/templates/invitation";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "member", "viewer"]),
});

export type InviteResult =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string[]> };

/**
 * Send an invitation email and create the invitation row.
 *
 * The invitee clicks the link, completes Clerk sign-up, and the Clerk webhook
 * notices the matching pending invitation and provisions them under the
 * inviting account (see src/lib/auth/provision.ts).
 *
 * Allowed roles: admin, member, viewer. The "owner" role is reserved for the
 * original account creator — promote-to-owner is a separate explicit action.
 */
export async function sendInvitationAction(
  _prev: InviteResult | undefined,
  formData: FormData
): Promise<InviteResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const invitation = await createInvitation({
      accountId: account.id,
      actorUserId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    });

    const acceptUrl = `${APP_URL}/invitations/${invitation.token}`;
    const html = await renderInvitationEmail({
      accountName: account.name,
      inviterName: user.fullName ?? user.workEmail,
      acceptUrl,
      expiresAt: invitation.expiresAt.toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    });

    const result = await sendEmail({
      to: parsed.data.email,
      subject: `${user.fullName ?? user.workEmail} invited you to ${account.name} on Renewal Radar`,
      html,
    });

    if (!result.ok) {
      // The invitation is still persisted; surface the email failure so the
      // admin knows to share the link out-of-band.
      return {
        ok: false,
        formError:
          "Invitation saved, but the email didn't send. Share the link manually.",
      };
    }

    revalidatePath("/settings/team");
    return { ok: true };
  } catch (err) {
    console.error("[sendInvitationAction] failed:", err);
    const msg = err instanceof Error ? err.message : "Couldn't send the invite.";
    return { ok: false, formError: msg };
  }
}

export async function revokeInvitationAction(
  invitationId: string
): Promise<InviteResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, formError: err.message };
    throw err;
  }

  try {
    await revokeInvitation({
      accountId: account.id,
      actorUserId: user.id,
      invitationId,
    });
    revalidatePath("/settings/team");
    return { ok: true };
  } catch (err) {
    console.error("[revokeInvitationAction] failed:", err);
    return { ok: false, formError: "Couldn't revoke. Please try again." };
  }
}
