"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, X } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  recurringChargeHasMatchAction,
  reviewRecurringChargeAction,
} from "@app/(app)/spend/actions";

/**
 * One detected recurring-charge suggestion. Resolves on mount whether an
 * existing subscription matches → offers "Confirm match" vs "Create draft".
 * Every path is human-confirmed (advisor, never agent).
 */
export function RecurringChargeRow(props: {
  id: string;
  vendorName: string;
  cycle: string;
  typicalAmountCents: number;
  currency: string;
  confidence: number;
  sampleSize: number;
  amountDriftPct: number;
  needsManualConfirm: boolean;
  projectedNextChargeOn: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [hasMatch, setHasMatch] = useState<boolean | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    let alive = true;
    recurringChargeHasMatchAction(props.id).then((r) => {
      if (alive && r.ok) setHasMatch(r.hasMatch);
    });
    return () => {
      alive = false;
    };
  }, [props.id]);

  function run(mode: "match" | "match_apply_price" | "create_draft" | "dismiss", ok: string) {
    startTransition(async () => {
      const r = await reviewRecurringChargeAction({ recurringChargeId: props.id, mode });
      if (!r.ok) {
        toast({ title: "Couldn't update", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: ok });
    });
  }

  const amount = (props.typicalAmountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: props.currency,
    maximumFractionDigits: 0,
  });

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{props.vendorName}</span>
            <span className="text-[10px] uppercase tracking-wide rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
              {props.cycle}
            </span>
            <span
              className={
                "text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 " +
                (props.confidence >= 80
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800")
              }
            >
              {props.confidence}% confident
            </span>
            {props.amountDriftPct > 0 && (
              <span className="text-[10px] uppercase tracking-wide rounded bg-red-100 text-red-700 px-1.5 py-0.5">
                +{props.amountDriftPct}% price
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            ~{amount}/{props.cycle.replace("ly", "")} · {props.sampleSize} charges
            {props.projectedNextChargeOn
              ? ` · next ~${props.projectedNextChargeOn}`
              : ""}
            {props.needsManualConfirm ? " · needs manual confirm" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasMatch ? (
            <button
              type="button"
              onClick={() => run("match", "Linked to existing subscription")}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-3 py-1.5 text-sm font-medium"
            >
              <Link2 className="h-3.5 w-3.5" />
              Confirm match
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run("create_draft", "Draft subscription created")}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-3 py-1.5 text-sm font-medium"
            >
              <Check className="h-3.5 w-3.5" />
              Add as subscription
            </button>
          )}
          <button
            type="button"
            onClick={() => run("dismiss", "Dismissed")}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background hover:bg-muted/40 px-3 py-1.5 text-sm"
          >
            <X className="h-3.5 w-3.5" />
            Not a subscription
          </button>
        </div>
      </div>
    </div>
  );
}
