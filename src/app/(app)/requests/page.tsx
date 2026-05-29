import Link from "next/link";
import { Plus, Inbox } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { listIntakeRequests } from "@server/application/intake-requests";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@ui/components/shared/page-header";
import { Button } from "@ui/components/primitives/button";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency, formatDate } from "@shared/utils";

/**
 * Procurement intake list.
 *   - Members see only their own requests.
 *   - Owners/admins see all.
 */
export const dynamic = "force-dynamic";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const { account, user } = await getCurrentAccountAndUser();
  const isApprover = user.role === "owner" || user.role === "admin";

  const status =
    sp.status === "pending" ||
    sp.status === "approved" ||
    sp.status === "denied" ||
    sp.status === "duplicate" ||
    sp.status === "withdrawn"
      ? sp.status
      : undefined;

  const rows = await listIntakeRequests(account.id, {
    status,
    requesterUserId: isApprover ? undefined : user.id,
  });

  // Pull requester display info in one query (small N).
  const requesterIds = Array.from(new Set(rows.map((r) => r.requesterUserId)));
  const requesters = requesterIds.length
    ? await db
        .select({
          id: usersTable.id,
          email: usersTable.workEmail,
          fullName: usersTable.fullName,
        })
        .from(usersTable)
        .where(eq(usersTable.accountId, account.id))
    : [];
  const requesterById = new Map(requesters.map((u) => [u.id, u]));

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader>
        <PageHeader.Row>
          <div className="space-y-2 min-w-0">
            <PageHeader.Title>Procurement requests</PageHeader.Title>
            <PageHeader.Description>
              {isApprover
                ? "Review and approve incoming SaaS requests. Approved requests become drafts under Subscriptions for you to finish with real contract terms."
                : "Submit a request when you want the team to start paying for a new SaaS. Procurement reviews each one and you'll get an email with the decision."}
            </PageHeader.Description>
          </div>
          <PageHeader.Actions>
            <Button asChild>
              <Link href="/requests/new">
                <Plus />
                New request
              </Link>
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
      </PageHeader>

      <div className="flex flex-wrap gap-2 text-xs">
        <StatusFilterLink current={status} value={undefined} label="All" />
        <StatusFilterLink current={status} value="pending" label="Pending" />
        <StatusFilterLink current={status} value="approved" label="Approved" />
        <StatusFilterLink current={status} value="denied" label="Denied" />
        <StatusFilterLink current={status} value="duplicate" label="Duplicate" />
        <StatusFilterLink
          current={status}
          value="withdrawn"
          label="Withdrawn"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border bg-background px-6 py-12 text-center text-sm text-muted-foreground space-y-3">
          <Inbox className="h-6 w-6 mx-auto text-muted-foreground/60" />
          <div>
            {isApprover
              ? "No requests to review."
              : "No requests yet — submit one when you want the team to try a new SaaS."}
          </div>
        </div>
      ) : (
        <ul className="rounded-md border divide-y bg-background">
          {rows.map((r) => {
            const requester = requesterById.get(r.requesterUserId);
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="block px-4 py-3 hover:bg-muted/30"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {r.vendor}{" "}
                          <span className="text-muted-foreground">
                            · {r.product}
                          </span>
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {requester?.fullName ?? requester?.email ?? "Unknown"}
                        <span className="px-1">·</span>
                        Submitted {formatDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                      ~{formatCurrency(r.estimatedAnnualUsdCents)} /yr
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusFilterLink({
  current,
  value,
  label,
}: {
  current: string | undefined;
  value: string | undefined;
  label: string;
}) {
  const isActive = current === value;
  const href = value ? `/requests?status=${value}` : "/requests";
  return (
    <Link
      href={href}
      className={
        isActive
          ? "rounded-full border bg-foreground text-background px-3 py-1"
          : "rounded-full border bg-background hover:bg-muted/40 px-3 py-1 text-muted-foreground"
      }
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved"
      ? "default"
      : status === "denied"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
      {status}
    </Badge>
  );
}
