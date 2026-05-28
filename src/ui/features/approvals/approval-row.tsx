"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Badge } from "@ui/components/primitives/badge";
import { useToast } from "@ui/hooks/use-toast";
import { approveRenewalDecisionAction } from "@/app/(app)/approvals/actions";
import { formatCurrency, formatDate } from "@shared/utils";
import type { PendingApprovalRow } from "@server/infrastructure/db/repositories/approvals";

/**
 * Single pending-approval row with inline approve/reject controls.
 *
 * Approving a decision is irreversible (it processes the renewal event and
 * may move the subscription to pending_cancellation). The button is disabled
 * for the user who recorded the decision — they can't approve themselves.
 */
export function ApprovalRow({
  row,
  currentUserId,
}: {
  row: PendingApprovalRow;
  currentUserId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const ownDecision = row.decidedByUserId === currentUserId;

  function handle(approve: boolean) {
    startTransition(async () => {
      const r = await approveRenewalDecisionAction(
        row.renewalEventId,
        approve
      );
      if (r.ok) {
        toast({
          title: approve ? "Decision approved" : "Decision rejected",
          description: approve
            ? "Downstream state updated."
            : "The renewal returned to the action queue.",
        });
        router.refresh();
      } else {
        toast({ title: "Couldn't process", description: r.error });
      }
    });
  }

  return (
    <div className="rounded-md border bg-white p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-medium">
            <Link
              href={`/subscriptions/${row.subscriptionId}/decide?event=${row.renewalEventId}`}
              className="hover:underline"
            >
              {row.vendorName} — {row.productName}
            </Link>
          </div>
          <Badge variant="outline" className="capitalize">
            {row.decision.replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Decided by{" "}
          <strong>
            {row.decidedByName ?? row.decidedByEmail ?? "unknown"}
            {ownDecision && " (you)"}
          </strong>{" "}
          {row.decisionAt && `on ${formatDate(row.decisionAt)}`} · Notice deadline{" "}
          {formatDate(row.noticeDeadline)} ·{" "}
          {formatCurrency(row.annualValueCents)}/yr
        </div>
        {row.decisionNote && (
          <div className="text-sm text-muted-foreground mt-1 italic">
            "{row.decisionNote}"
          </div>
        )}
      </div>

      <div className="flex gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handle(false)}
          disabled={pending || ownDecision}
          title={ownDecision ? "Cannot approve your own decision" : undefined}
        >
          <X className="mr-1 h-4 w-4" />
          Reject
        </Button>
        <Button
          size="sm"
          onClick={() => handle(true)}
          disabled={pending || ownDecision}
          title={ownDecision ? "Cannot approve your own decision" : undefined}
        >
          <Check className="mr-1 h-4 w-4" />
          Approve
        </Button>
      </div>
    </div>
  );
}
