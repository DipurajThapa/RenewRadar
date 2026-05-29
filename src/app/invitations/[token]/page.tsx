import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { getInvitationByToken } from "@server/infrastructure/db/repositories/invitations";
import { countActiveUsers } from "@server/infrastructure/db/repositories/users";
import { countPendingInvitations } from "@server/infrastructure/db/repositories/invitations";
import { db } from "@server/infrastructure/db/client";
import { eq } from "drizzle-orm";
import { accountsTable } from "@server/infrastructure/db/schema";
import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";

export const dynamic = "force-dynamic";

/**
 * Public invitation landing page. Anyone with the URL can read it, but
 * accepting requires signing up via Clerk — the provisioner reads the
 * pending invitation row matching the new user's email + token (passed via
 * a `?invitation_token=…` query on the sign-up URL).
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: { token: string };
}) {
  const invitation = await getInvitationByToken(params.token);

  if (!invitation) {
    // Either invalid, accepted, or expired. Redirect to the marketing home
    // with a faint hint so the user knows their link's done.
    redirect("/?invitation=invalid");
  }

  // Resolve the account name and plan tier for display + cap pre-check.
  const [account] = await db
    .select({ name: accountsTable.name, planTier: accountsTable.planTier })
    .from(accountsTable)
    .where(eq(accountsTable.id, invitation.accountId));

  // Pre-check seat cap. If the inviting account no longer has room, show a
  // clear "your inviter needs to upgrade" message instead of letting the
  // invitee sign up and then get stuck at setup-pending. This is the
  // friendly counterpart to the hard cap check in `provisionNewUser`.
  const maxUsers = account
    ? TIER_DEFINITIONS[account.planTier as PlanTier].limits.maxUsers
    : Number.POSITIVE_INFINITY;
  let seatsAvailable = true;
  if (Number.isFinite(maxUsers)) {
    const [activeUsers, pendingInvites] = await Promise.all([
      countActiveUsers(invitation.accountId),
      countPendingInvitations(invitation.accountId),
    ]);
    // Subtract self (this invitation row is already in pendingInvites)
    seatsAvailable = activeUsers + pendingInvites <= maxUsers;
  }

  const signUpHref = `/sign-up?invitation_token=${
    invitation.token
  }&email=${encodeURIComponent(invitation.email)}`;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-8 space-y-4 text-center">
          <h1 className="text-xl font-semibold">
            You're invited to {account?.name ?? "a Renewal Radar workspace"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Renewal Radar tracks every SaaS subscription's notice deadline so
            the team never discovers an auto-renewal too late. Sign up with{" "}
            <strong>{invitation.email}</strong> to accept this invitation —
            your account will be linked automatically.
          </p>
          <p className="text-xs text-muted-foreground">
            Link expires {invitation.expiresAt.toLocaleDateString("en-US")} ·
            Role: <span className="capitalize">{invitation.role}</span>
          </p>
          {!seatsAvailable && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-left">
              <p className="text-sm font-medium text-amber-900">
                This workspace is at its seat limit
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Your inviter needs to upgrade their Renewal Radar plan before
                you can accept. Ask them to bump the plan in Settings →
                Billing and try this link again.
              </p>
            </div>
          )}
          <div className="pt-2">
            <Button asChild disabled={!seatsAvailable}>
              <Link
                href={seatsAvailable ? signUpHref : "#"}
                aria-disabled={!seatsAvailable}
              >
                Accept and create my account
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
