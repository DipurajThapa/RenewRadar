"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ui/components/primitives/dialog";
import { useToast } from "@ui/hooks/use-toast";
import { SubscriptionForm } from "./subscription-form";
import type { AccountUserOption } from "@server/infrastructure/db/repositories/users";

/**
 * Modal "Add subscription" button for the list page.
 *
 * Renders a Dialog wrapping the same SubscriptionForm used by /subscriptions/new.
 * On success, closes the dialog, refreshes the route to pick up the new row,
 * and shows a confirmation toast so the user knows the save landed.
 *
 * The /subscriptions/new full-page route is intentionally preserved so direct
 * URLs and the empty-state CTA still work — modal and full-page coexist.
 */
export function AddSubscriptionButton({
  users,
  currentUserId,
}: {
  users: AccountUserOption[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add subscription
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        // Block accidental dismissal while the form is mid-submit;
        // the form's own Cancel button is the explicit exit path.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add subscription</DialogTitle>
          <DialogDescription>
            Track a new SaaS subscription so we can monitor its notice deadline.
          </DialogDescription>
        </DialogHeader>

        <SubscriptionForm
          mode="create"
          users={users}
          currentUserId={currentUserId}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
            toast({
              title: "Subscription added",
              description: "Now tracking its notice deadline.",
            });
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
