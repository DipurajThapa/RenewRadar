"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  connectSpendFeedAction,
  syncSpendFeedAction,
} from "@app/(app)/spend/actions";

export function ConnectFeedButton({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function connect() {
    startTransition(async () => {
      const r = await connectSpendFeedAction();
      if (!r.ok) {
        toast({ title: "Couldn't connect", description: r.error });
        return;
      }
      router.refresh();
      toast({
        title: "Spend feed connected",
        description: "Your inventory is populating itself — no typing required.",
      });
    });
  }

  function sync() {
    startTransition(async () => {
      const r = await syncSpendFeedAction();
      if (!r.ok) {
        toast({ title: "Couldn't sync", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Synced" });
    });
  }

  if (connected) {
    return (
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border bg-background hover:bg-muted/40 px-3 py-2 text-sm font-medium"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary hover:bg-primary-strong text-primary-foreground px-4 py-2 text-sm font-medium"
    >
      <Plug className="h-4 w-4" />
      {pending ? "Connecting…" : "Connect spend feed"}
    </button>
  );
}
