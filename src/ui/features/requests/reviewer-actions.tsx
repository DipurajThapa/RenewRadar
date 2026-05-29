"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Copy } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { useToast } from "@ui/hooks/use-toast";
import {
  approveRequestAction,
  denyRequestAction,
  markDuplicateRequestAction,
} from "@app/(app)/requests/actions";

type Mode = "idle" | "approve" | "deny" | "duplicate";

/**
 * Three-pane reviewer actions for an intake request:
 *   - Approve → optional note, creates draft sub
 *   - Deny → required reason
 *   - Mark duplicate → required existing subscription id
 *
 * Defensive: the action layer also re-checks pending state, so a stale
 * page won't corrupt anything if the operator clicks after a coworker
 * already acted.
 */
export function IntakeReviewerActions({
  requestId,
}: {
  requestId: string;
  accountId: string;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function reset() {
    setMode("idle");
    setNote("");
    setSubscriptionId("");
  }

  function handleApprove() {
    startTransition(async () => {
      const r = await approveRequestAction({
        requestId,
        reviewerNote: note.trim() || null,
      });
      if (!r.ok) {
        toast({ title: "Couldn't approve", description: r.error });
        return;
      }
      router.refresh();
      toast({
        title: "Request approved",
        description:
          "A draft subscription was created — finish the term details under Subscriptions.",
      });
      reset();
    });
  }

  function handleDeny() {
    startTransition(async () => {
      const r = await denyRequestAction({ requestId, reviewerNote: note });
      if (!r.ok) {
        toast({ title: "Couldn't deny", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Request denied" });
      reset();
    });
  }

  function handleDuplicate() {
    startTransition(async () => {
      const r = await markDuplicateRequestAction({
        requestId,
        linkedSubscriptionId: subscriptionId.trim(),
        reviewerNote: note.trim() || null,
      });
      if (!r.ok) {
        toast({ title: "Couldn't mark duplicate", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Marked as duplicate" });
      reset();
    });
  }

  if (mode === "idle") {
    return (
      <section className="rounded-md border bg-background p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Review
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("approve")}>
            <Check className="mr-2 h-4 w-4" />
            Approve
          </Button>
          <Button onClick={() => setMode("deny")} variant="outline">
            <X className="mr-2 h-4 w-4" />
            Deny
          </Button>
          <Button onClick={() => setMode("duplicate")} variant="outline">
            <Copy className="mr-2 h-4 w-4" />
            Mark duplicate
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-background p-4 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {mode === "approve"
          ? "Approve request"
          : mode === "deny"
            ? "Deny request"
            : "Mark as duplicate"}
      </h2>

      {mode === "duplicate" && (
        <div>
          <label className="text-xs text-muted-foreground" htmlFor="dup-sub">
            Subscription ID this duplicates (UUID)
          </label>
          <input
            id="dup-sub"
            type="text"
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
            disabled={pending}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="mt-1 block w-full font-mono text-xs border rounded-md p-2 bg-background"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Paste the URL UUID of the existing subscription.
          </p>
        </div>
      )}

      <div>
        <label className="text-xs text-muted-foreground" htmlFor="review-note">
          {mode === "deny"
            ? "Reason (required, ≥ 8 chars)"
            : "Note (optional)"}
        </label>
        <textarea
          id="review-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          disabled={pending}
          placeholder={
            mode === "deny"
              ? "e.g. Out of budget this quarter, revisit Q3"
              : ""
          }
          className="mt-1 block w-full text-sm border rounded-md p-2 bg-background"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={reset} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={
            mode === "approve"
              ? handleApprove
              : mode === "deny"
                ? handleDeny
                : handleDuplicate
          }
          disabled={
            pending ||
            (mode === "deny" && note.trim().length < 8) ||
            (mode === "duplicate" && subscriptionId.trim() === "")
          }
        >
          {pending
            ? "Saving…"
            : mode === "approve"
              ? "Approve + create draft"
              : mode === "deny"
                ? "Deny"
                : "Mark duplicate"}
        </Button>
      </div>
    </section>
  );
}
