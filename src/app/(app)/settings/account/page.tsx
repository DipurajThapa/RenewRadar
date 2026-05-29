import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { AccountForm } from "@ui/features/settings/account-form";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const { account, user } = await getCurrentAccountAndUser();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Public-facing name and billing contact for this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            accountName={account.name}
            billingEmail={account.billingEmail}
            timezone={account.timezone}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            Identity and role inside this account. Authentication lives in
            Clerk — open the user menu in the top-right to change name,
            email, or password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-y-3 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{user.fullName ?? "—"}</dd>

            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium tabular-nums">{user.workEmail}</dd>

            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <Badge variant="secondary" className="capitalize">
                {user.role}
              </Badge>
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
