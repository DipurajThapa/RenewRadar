"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ui/components/primitives/button";
import { useToast } from "@ui/hooks/use-toast";
import { toggleApprovalsRequiredAction } from "@/app/(app)/settings/account/actions";

/**
 * Per-account toggle for approvals-lite. Admin/owner only.
 *
 * Turning it on starts gating new renewal decisions through the Approvals
 * page; existing in-flight decisions are unaffected. Turning it off lets
 * future decisions land directly as "processed" again — already-pending
 * approvals continue to need approval until they're cleared.
 */
export function ApprovalsToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleToggle() {
    const next = !enabled;
    startTransition(async () => {
      const r = await toggleApprovalsRequiredAction(next);
      if (r.ok) {
        setEnabled(next);
        toast({
          title: next ? "Approvals required" : "Approvals off",
          description: next
            ? "New renewal decisions need a second admin to approve."
            : "Decisions land as processed immediately again.",
        });
        router.refresh();
      } else {
        toast({ title: "Couldn't save", description: r.formError });
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-medium">
          Require a second admin to approve decisions
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Separation of duties: a decision is "pending" until a different
          admin/owner clears it on the Approvals page.
        </p>
      </div>
      <Button
        type="button"
        variant={enabled ? "default" : "outline"}
        size="sm"
        onClick={handleToggle}
        disabled={pending}
      >
        {pending ? "Saving…" : enabled ? "On" : "Off"}
      </Button>
    </div>
  );
}
