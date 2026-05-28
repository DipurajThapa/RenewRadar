"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import { deleteSubscriptionAction } from "@/app/(app)/subscriptions/actions";

export function DeleteSubscriptionButton({
  subscriptionId,
  vendorName,
  productName,
}: {
  subscriptionId: string;
  vendorName: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      await deleteSubscriptionAction(subscriptionId);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-red-700 border-red-200 hover:bg-red-50 hover:text-red-800"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Cancel
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this subscription?</DialogTitle>
            <DialogDescription>
              This marks <strong>{vendorName} — {productName}</strong> as
              cancelled in Renewal Radar. It does <em>not</em> notify the
              vendor — Renewal Radar never sends cancellation emails on your
              behalf.
              <br />
              <br />
              To formally cancel with the vendor, open the Decide-Now flow
              for the current renewal and use the cancellation letter draft;
              you'll send it from your own email.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Keep tracking
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Cancelling..." : "Mark as cancelled"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
