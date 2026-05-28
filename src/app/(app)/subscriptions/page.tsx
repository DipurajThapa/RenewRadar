import Link from "next/link";
import { Download } from "lucide-react";
import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { listSubscriptions } from "@/lib/db/queries/subscriptions";
import { listAccountUsers } from "@/lib/db/queries/users";
import { PLAN_LIMITS } from "@/lib/billing/plans";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { SubscriptionsEmptyState } from "@/components/subscriptions/empty-state";
import { AddSubscriptionButton } from "@/components/subscriptions/add-subscription-button";
import { OwnerFilter } from "@/components/subscriptions/owner-filter";
import { ImportCsvButton } from "@/components/subscriptions/import-csv-button";

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
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {subscriptions.length} tracked{limitLabel}
            {ownerFilter ? " (filtered)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {users.length > 1 && <OwnerFilter users={users} />}
          {subscriptions.length > 0 && (
            <Link
              href="/api/export/subscriptions"
              className="inline-flex items-center justify-center rounded-md border bg-white px-3 py-2 text-sm hover:bg-muted/40"
              prefetch={false}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Link>
          )}
          <ImportCsvButton users={users} currentUserId={user.id} />
          <AddSubscriptionButton users={users} currentUserId={user.id} />
        </div>
      </header>

      {subscriptions.length === 0 ? (
        <SubscriptionsEmptyState />
      ) : (
        <SubscriptionsTable subscriptions={subscriptions} />
      )}
    </div>
  );
}
