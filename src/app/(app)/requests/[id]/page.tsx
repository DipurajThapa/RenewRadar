import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { getIntakeRequest } from "@server/application/intake-requests";
import { db } from "@server/infrastructure/db/client";
import { usersTable } from "@server/infrastructure/db/schema";
import { PageHeader } from "@ui/components/shared/page-header";
import { Badge } from "@ui/components/primitives/badge";
import { formatCurrency, formatDate } from "@shared/utils";
import { IntakeReviewerActions } from "@ui/features/requests/reviewer-actions";
import { WithdrawRequestButton } from "@ui/features/requests/withdraw-button";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { account, user } = await getCurrentAccountAndUser();
  const req = await getIntakeRequest(account.id, id);
  if (!req) notFound();

  // Member can only see their own.
  const isApprover = user.role === "owner" || user.role === "admin";
  if (!isApprover && req.requesterUserId !== user.id) {
    notFound();
  }

  const [requester] = await db
    .select({
      id: usersTable.id,
      email: usersTable.workEmail,
      fullName: usersTable.fullName,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.requesterUserId));

  let reviewer:
    | { id: string; email: string; fullName: string | null }
    | null = null;
  if (req.reviewerUserId) {
    const [r] = await db
      .select({
        id: usersTable.id,
        email: usersTable.workEmail,
        fullName: usersTable.fullName,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.reviewerUserId));
    reviewer = r ?? null;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <Link
        href="/requests"
        className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to requests
      </Link>

      <PageHeader>
        <PageHeader.Row>
          <div className="space-y-2 min-w-0">
            <PageHeader.Title>
              <span className="inline-flex items-center gap-2">
                {req.vendor}
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{req.product}</span>
                <StatusBadge status={req.status} />
              </span>
            </PageHeader.Title>
            <PageHeader.Description>
              Submitted by {requester?.fullName ?? requester?.email ?? "unknown"} on{" "}
              {formatDate(req.createdAt)}
              <span className="px-1">·</span>~
              {formatCurrency(req.estimatedAnnualUsdCents)} /yr
            </PageHeader.Description>
          </div>
        </PageHeader.Row>
      </PageHeader>

      <section className="rounded-md border bg-background p-4 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Business case
        </h2>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {req.businessCase}
        </p>
        {(req.planNotes || req.expectedStartDate) && (
          <dl className="text-xs text-muted-foreground grid grid-cols-2 gap-2 pt-2">
            {req.planNotes && (
              <>
                <dt className="font-medium text-foreground">Plan notes</dt>
                <dd>{req.planNotes}</dd>
              </>
            )}
            {req.expectedStartDate && (
              <>
                <dt className="font-medium text-foreground">Expected start</dt>
                <dd>{formatDate(req.expectedStartDate)}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      {req.status !== "pending" && (
        <section className="rounded-md border bg-background p-4 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Review
          </h2>
          <div className="text-sm">
            <strong>{req.status}</strong>
            {reviewer && (
              <span className="text-muted-foreground">
                {" "}
                by {reviewer.fullName ?? reviewer.email}
              </span>
            )}
            {req.reviewedAt && (
              <span className="text-muted-foreground">
                {" "}
                on {formatDate(req.reviewedAt)}
              </span>
            )}
          </div>
          {req.reviewerNote && (
            <p className="text-sm text-muted-foreground italic">
              &ldquo;{req.reviewerNote}&rdquo;
            </p>
          )}
          {req.createdSubscriptionId && (
            <div className="text-xs">
              Created draft subscription:{" "}
              <Link
                href={`/subscriptions/${req.createdSubscriptionId}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                View it →
              </Link>
            </div>
          )}
          {req.linkedExistingSubscriptionId && (
            <div className="text-xs">
              Marked duplicate of:{" "}
              <Link
                href={`/subscriptions/${req.linkedExistingSubscriptionId}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                View the existing subscription →
              </Link>
            </div>
          )}
        </section>
      )}

      {req.status === "pending" && isApprover && (
        <IntakeReviewerActions
          requestId={req.id}
          accountId={account.id}
        />
      )}

      {req.status === "pending" && req.requesterUserId === user.id && (
        <WithdrawRequestButton requestId={req.id} />
      )}
    </div>
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
