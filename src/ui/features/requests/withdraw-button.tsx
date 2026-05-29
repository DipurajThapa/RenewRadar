"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ui/components/primitives/button";
import { useToast } from "@ui/hooks/use-toast";
import { withdrawRequestAction } from "@app/(app)/requests/actions";

export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleClick() {
    if (!confirm("Withdraw this request? You can submit a new one anytime.")) {
      return;
    }
    startTransition(async () => {
      const r = await withdrawRequestAction(requestId);
      if (!r.ok) {
        toast({ title: "Couldn't withdraw", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: "Request withdrawn" });
    });
  }

  return (
    <section className="rounded-md border bg-background p-4 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Your options
      </h2>
      <p className="text-sm text-muted-foreground">
        You can withdraw this request anytime before it&apos;s reviewed.
      </p>
      <Button variant="outline" onClick={handleClick} disabled={pending}>
        {pending ? "Withdrawing…" : "Withdraw request"}
      </Button>
    </section>
  );
}
