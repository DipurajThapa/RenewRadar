"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardEdit } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/primitives/dialog";
import { Label } from "@ui/components/primitives/label";
import { useToast } from "@ui/hooks/use-toast";
import { quickAddDraftAction } from "@app/(app)/subscriptions/actions";

/**
 * Quick-add a draft subscription (T2.7).
 *
 * The user gives us just three things — vendor name, product name, and the
 * estimated annual spend. We persist a `status = 'draft'` row that's visible
 * in the subscriptions list but never fires alerts or shows up in the action
 * queue. The user fills in the rest later via the normal edit form, at
 * which point the row is promoted to `active` and the renewal event is
 * created lazily.
 *
 * Intended for the "I know we pay for Asana, I don't have the contract on
 * me" moment. The full add form is one click away when the user does have
 * the contract.
 */
export function QuickAddDraftButton() {
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [product, setProduct] = useState("");
  const [annualDollars, setAnnualDollars] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleClose(next: boolean) {
    setOpen(next);
    if (!next) {
      setVendor("");
      setProduct("");
      setAnnualDollars("");
      setError(null);
    }
  }

  function handleSubmit() {
    setError(null);
    const annualNumber = Number(annualDollars);
    if (!Number.isFinite(annualNumber) || annualNumber < 0) {
      setError("Annual cost must be a number.");
      return;
    }
    startTransition(async () => {
      const r = await quickAddDraftAction({
        vendorName: vendor,
        productName: product,
        annualizedUsdCents: Math.round(annualNumber * 100),
      });
      if (!r.ok) {
        setError(r.formError);
        return;
      }
      toast({
        title: "Draft saved",
        description:
          "Open the subscription to add term dates and turn it into a tracked renewal.",
      });
      handleClose(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ClipboardEdit className="mr-2 h-4 w-4" />
        Quick add (draft)
      </Button>

      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Quick-add a draft</DialogTitle>
          <DialogDescription>
            Capture vendor + product + estimated annual cost. We&apos;ll keep
            it as a draft until you fill in the term dates — drafts don&apos;t
            fire renewal alerts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="draft-vendor">Vendor</Label>
            <input
              id="draft-vendor"
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              disabled={pending}
              placeholder="e.g. Slack, Inc."
              className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="draft-product">Product</Label>
            <input
              id="draft-product"
              type="text"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              disabled={pending}
              placeholder="e.g. Business+"
              className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
            />
          </div>
          <div>
            <Label htmlFor="draft-annual">Estimated annual cost (USD)</Label>
            <input
              id="draft-annual"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={annualDollars}
              onChange={(e) => setAnnualDollars(e.target.value)}
              disabled={pending}
              placeholder="12000"
              className="mt-1.5 block w-full text-sm border rounded-md p-2 bg-background"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                pending ||
                vendor.trim() === "" ||
                product.trim() === "" ||
                annualDollars === ""
              }
            >
              {pending ? "Saving…" : "Save draft"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
