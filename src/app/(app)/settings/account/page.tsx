import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { AccountForm } from "@ui/features/settings/account-form";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const { account, user } = await getCurrentAccountAndUser();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
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
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{user.fullName ?? "—"}</dd>

            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium">{user.workEmail}</dd>

            <dt className="text-muted-foreground">Role</dt>
            <dd className="font-medium capitalize">{user.role}</dd>
          </dl>
          <p className="text-xs text-muted-foreground pt-3 border-t">
            Update your name, email, or password from the user menu in the top
            right — Clerk handles authentication.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
