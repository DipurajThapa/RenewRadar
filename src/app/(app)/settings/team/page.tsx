import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { hasRole } from "@/lib/auth/rbac";
import { listAccountUsers } from "@/lib/db/queries/users";
import { listPendingInvitations } from "@/lib/db/queries/invitations";
import { TeamMembersList } from "@/components/settings/team-members-list";
import { InviteMemberForm } from "@/components/settings/invite-member-form";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const [members, pending] = await Promise.all([
    listAccountUsers(account.id),
    listPendingInvitations(account.id),
  ]);

  const canManage = hasRole(user, "admin");

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Team</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Members of {account.name}. Admins can invite new members and change
          their roles.
        </p>
      </header>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteMemberForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMembersList members={members} currentUserId={user.id} />
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {pending.map((inv) => (
                <li
                  key={inv.id}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <div>
                    <div className="font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Invited as {inv.role} · expires{" "}
                      {inv.expiresAt.toLocaleDateString("en-US")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
