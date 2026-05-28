import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { hasRole } from "@/lib/auth/rbac";
import { listPendingApprovals } from "@/lib/db/queries/approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ApprovalRow } from "@/components/approvals/approval-row";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const isApprover = hasRole(user, "admin");

  if (!isApprover) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Only admins and owners can approve renewal decisions. Reach out to
          your account admin if you need to escalate something.
        </p>
      </div>
    );
  }

  const pending = await listPendingApprovals(account.id);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Renewal decisions awaiting a second pair of eyes. You can't approve
          your own decisions — separation of duties is the point.
          {!account.requireApprovals && (
            <>
              {" "}
              Approvals-lite is off; turn it on in{" "}
              <Link
                href="/settings/account"
                className="underline underline-offset-4"
              >
                Account settings
              </Link>{" "}
              if you want all decisions to flow through this page.
            </>
          )}
        </p>
      </header>

      {pending.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Nothing waiting"
          description="Decisions land here when teammates record them while approvals-lite is on."
          variant="success"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{pending.length} pending</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((row) => (
              <ApprovalRow
                key={row.renewalEventId}
                row={row}
                currentUserId={user.id}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
