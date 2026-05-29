import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { hasRole } from "@server/middleware/rbac";
import { listPendingApprovals } from "@server/infrastructure/db/repositories/approvals";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/components/primitives/card";
import { EmptyState } from "@ui/components/shared/empty-state";
import { PageHeader } from "@ui/components/shared/page-header";
import { ApprovalRow } from "@ui/features/approvals/approval-row";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { account, user } = await getCurrentAccountAndUser();
  const isApprover = hasRole(user, "admin");

  if (!isApprover) {
    return (
      <div className="max-w-2xl space-y-3">
        <PageHeader>
          <PageHeader.Title>Approvals</PageHeader.Title>
          <PageHeader.Description>
            Only admins and owners can approve renewal decisions. Reach out
            to your account admin if you need to escalate something.
          </PageHeader.Description>
        </PageHeader>
      </div>
    );
  }

  const pending = await listPendingApprovals(account.id);

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader>
        <PageHeader.Title>Approvals</PageHeader.Title>
        <PageHeader.Description>
          Renewal decisions awaiting a second pair of eyes. You can't approve
          your own decisions — separation of duties is the point.
          {!account.requireApprovals && (
            <>
              {" "}Approvals-lite is off; turn it on in{" "}
              <Link
                href="/settings/account"
                className="underline underline-offset-4 text-foreground"
              >
                Account settings
              </Link>{" "}
              if you want all decisions to flow through this page.
            </>
          )}
        </PageHeader.Description>
      </PageHeader>

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
