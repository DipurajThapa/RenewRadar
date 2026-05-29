"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import { useToast } from "@ui/hooks/use-toast";
import { bulkReExtractAction } from "@app/(app)/documents/actions";

/**
 * Bulk re-extraction trigger (T3.7).
 *
 * Visible only to owners/admins. The action re-runs extraction across
 * every ready document in the account — useful after the AI provider
 * improves or the prompt changes. Each re-extraction counts against the
 * monthly AI pages budget (the extract function enforces the cap atomically
 * per-document, so an over-cap re-run lands a clean "N succeeded, M
 * skipped" rather than partial corruption).
 */
export function BulkReExtractButton({
  documentCount,
}: {
  documentCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleConfirm() {
    startTransition(async () => {
      const r = await bulkReExtractAction();
      if (!r.ok) {
        toast({ title: "Re-extraction failed", description: r.error });
        return;
      }
      router.refresh();
      toast({
        title: `Re-extraction queued`,
        description:
          r.skippedInFlight > 0
            ? `${r.dispatched} dispatched · ${r.skippedInFlight} skipped (already in flight)`
            : `${r.dispatched} dispatched. Check the review queue as fields come in.`,
      });
      setOpen(false);
    });
  }

  if (documentCount === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        title="Re-run AI extraction on every contract you've uploaded"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Re-extract all
      </Button>

      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Re-run extraction on every contract?</DialogTitle>
          <DialogDescription>
            We&apos;ll queue extraction for {documentCount} contract
            {documentCount === 1 ? "" : "s"}. Each will count against your
            monthly AI-pages budget; the extract job will skip any that would
            push you over the cap. New fields appear in the review queue as
            they finish.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={pending}>
            {pending ? "Queuing…" : "Yes, re-extract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
