import Link from "next/link";
import { Download } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listSubscriptions } from "@server/infrastructure/db/repositories/subscriptions";
import { listAccountUsers } from "@server/infrastructure/db/repositories/users";
import { PLAN_LIMITS } from "@server/infrastructure/billing/plans";
import { Button } from "@ui/components/primitives/button";
import { PageHeader } from "@ui/components/shared/page-header";
import { SubscriptionsTable } from "@ui/features/subscriptions/subscriptions-table";
import { SubscriptionsEmptyState } from "@ui/features/subscriptions/empty-state";
import { AddSubscriptionButton } from "@ui/features/subscriptions/add-subscription-button";
import { QuickAddDraftButton } from "@ui/features/subscriptions/quick-add-draft-button";
import { OwnerFilter } from "@ui/features/subscriptions/owner-filter";
import { ImportCsvButton } from "@ui/features/subscriptions/import-csv-button";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: { owner?: string };
}) {
  const { account, user } = await getCurrentAccountAndUser();
  const users = await listAccountUsers(account.id);

  // Normalize the owner query param: "unassigned", a UUID, or null
  const rawOwner = searchParams.owner;
  const ownerFilter: string | "unassigned" | null =
    rawOwner === "unassigned"
      ? "unassigned"
      : rawOwner && users.some((u) => u.id === rawOwner)
        ? rawOwner
        : null;

  const subscriptions = await listSubscriptions(account.id, {
    ownerUserId: ownerFilter,
  });

  const limit = PLAN_LIMITS[account.planTier]?.maxSubscriptions;
  const limitLabel =
    limit !== undefined && Number.isFinite(limit) ? ` of ${limit}` : "";

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeader.Row>
          <div className="space-y-2 min-w-0">
            <PageHeader.Title>Subscriptions</PageHeader.Title>
            <PageHeader.Description>
              {subscriptions.length} tracked{limitLabel}
              {ownerFilter ? " · filtered by owner" : ""}
            </PageHeader.Description>
          </div>
          <PageHeader.Actions>
            {users.length > 1 && <OwnerFilter users={users} />}
            {subscriptions.length > 0 && (
              <Button asChild variant="outline" size="default">
                <Link href="/api/export/subscriptions" prefetch={false}>
                  <Download />
                  Export CSV
                </Link>
              </Button>
            )}
            <ImportCsvButton users={users} currentUserId={user.id} />
            <QuickAddDraftButton />
            <AddSubscriptionButton users={users} currentUserId={user.id} />
          </PageHeader.Actions>
        </PageHeader.Row>
      </PageHeader>

      {subscriptions.length === 0 ? (
        <SubscriptionsEmptyState />
      ) : (
        <SubscriptionsTable subscriptions={subscriptions} />
      )}
    </div>
  );
}
