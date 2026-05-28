import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Button } from "@ui/components/primitives/button";
import { getInvitationByToken } from "@server/infrastructure/db/repositories/invitations";
import { db } from "@server/infrastructure/db/client";
import { eq } from "drizzle-orm";
import { accountsTable } from "@server/infrastructure/db/schema";

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

  // Resolve the account name for display.
  const [account] = await db
    .select({ name: accountsTable.name })
    .from(accountsTable)
    .where(eq(accountsTable.id, invitation.accountId));

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
          <div className="pt-2">
            <Button asChild>
              <Link href={signUpHref}>Accept and create my account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
