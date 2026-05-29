"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  acceptConnectionAction,
  declineConnectionAction,
} from "@app/vendor/connections/actions";

export function ConnectionRequestRow({
  connectionId,
  accountName,
}: {
  connectionId: string;
  accountName: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function decide(kind: "accept" | "decline") {
    startTransition(async () => {
      const r =
        kind === "accept"
          ? await acceptConnectionAction(connectionId)
          : await declineConnectionAction(connectionId);
      if (!r.ok) {
        toast({ title: "Couldn't update", description: r.error });
        return;
      }
      router.refresh();
      toast({
        title: kind === "accept" ? "Connected" : "Request declined",
      });
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{accountName}</div>
        <div className="text-xs text-muted-foreground">
          wants to receive your announcements
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => decide("accept")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-sm font-medium"
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
        <button
          type="button"
          onClick={() => decide("decline")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border bg-white hover:bg-muted/40 px-3 py-1.5 text-sm"
        >
          <X className="h-3.5 w-3.5" />
          Decline
        </button>
      </div>
    </div>
  );
}
