import Link from "next/link";
import { ListChecks } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { buildNeedsYouQueue } from "@server/application/needs-you";
import type { NeedsYouType } from "@server/domain/needs-you/rank";
import { NeedsYouView } from "@ui/features/needs-you/needs-you-view";
import { EmptyState } from "@ui/components/shared/empty-state";
import { PageHeader } from "@ui/components/shared/page-header";
import { Button } from "@ui/components/primitives/button";

export const dynamic = "force-dynamic";

const VALID_TYPES: NeedsYouType[] = [
  "renewal",
  "review",
  "approval",
  "request",
  "spend",
];

/**
 * "Needs you" — the unified queue (P2-S5). Converges the four separate workflow
 * inboxes (review-queue / approvals / requests / spend) plus renewal decisions
 * into ONE list ranked by cross-type urgency. Each row deep-links to its native
 * action surface; the source pages stay reachable in the nav. The renewal-risk
 * narrative now lives on the dashboard's account-risk card.
 */
export default async function ActionQueuePage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const queue = await buildNeedsYouQueue(account.id);

  const activeType: NeedsYouType | "all" = VALID_TYPES.includes(
    searchParams.type as NeedsYouType
  )
    ? (searchParams.type as NeedsYouType)
    : "all";

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeader.Title>Needs you</PageHeader.Title>
        <PageHeader.Description>
          Everything across renewals, reviews, approvals, requests, and detected
          spend — one list, ranked by urgency.
        </PageHeader.Description>
      </PageHeader>

      {queue.items.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="You're all clear"
          description="Nothing needs your attention right now. New items appear here as renewals approach, documents are extracted, and charges are detected."
          variant="success"
          action={
            <Button asChild variant="outline">
              <Link href="/subscriptions">View all subscriptions</Link>
            </Button>
          }
        />
      ) : (
        <NeedsYouView queue={queue} activeType={activeType} />
      )}
    </div>
  );
}
