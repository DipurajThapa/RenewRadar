"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Flag, ShieldOff, X } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  acceptVendorUpdateAction,
  blockVendorFromInboxAction,
  dismissVendorUpdateAction,
  reportVendorUpdateAction,
} from "@app/(app)/vendor-updates/actions";

type Status = "delivered" | "read" | "accepted" | "dismissed";

export function VendorUpdateCard(props: {
  deliveryId: string;
  vendorOrgId: string;
  vendorName: string;
  vendorVerified: boolean;
  kindLabel: string;
  title: string;
  body: string;
  effectiveDate: string | null;
  status: Status;
  reported: boolean;
  canBlock: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ title: "Couldn't update", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: ok });
    });
  }

  const actioned = props.status === "accepted" || props.status === "dismissed";

  return (
    <div
      className={
        "rounded-lg border bg-white p-4 " +
        (props.status === "delivered" ? "border-indigo-200 bg-indigo-50/30" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide rounded bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground">
              {props.kindLabel}
            </span>
            <span className="text-sm font-medium inline-flex items-center gap-1">
              {props.vendorName}
              {props.vendorVerified && (
                <BadgeCheck className="h-3.5 w-3.5 text-teal-600" />
              )}
            </span>
            {props.status === "accepted" && (
              <span className="text-[10px] uppercase tracking-wide text-teal-700">
                accepted
              </span>
            )}
            {props.status === "dismissed" && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                dismissed
              </span>
            )}
            {props.reported && (
              <span className="text-[10px] uppercase tracking-wide text-red-600">
                reported
              </span>
            )}
          </div>
          <h3 className="font-medium mt-1.5">{props.title}</h3>
          {props.effectiveDate && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Effective {props.effectiveDate}
            </p>
          )}
          <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-1.5">
            {props.body}
          </p>
        </div>
      </div>

      {!actioned && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
          <button
            type="button"
            onClick={() =>
              run(() => acceptVendorUpdateAction(props.deliveryId), "Accepted")
            }
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 px-3 py-1.5 text-sm font-medium"
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </button>
          <button
            type="button"
            onClick={() =>
              run(() => dismissVendorUpdateAction(props.deliveryId), "Dismissed")
            }
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background hover:bg-muted/40 px-3 py-1.5 text-sm"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => {
              const reason = prompt(
                "Report this update to Renewal Radar. What's wrong with it? (e.g. spam, not a real notice)"
              );
              if (reason && reason.trim()) {
                run(
                  () =>
                    reportVendorUpdateAction({
                      deliveryId: props.deliveryId,
                      reason: reason.trim(),
                    }),
                  "Reported — thanks, our team will review it"
                );
              }
            }}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border bg-white hover:bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
          >
            <Flag className="h-3.5 w-3.5" />
            Report
          </button>
          {props.canBlock && (
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    `Block ${props.vendorName}? They won't be able to send you further updates.`
                  )
                ) {
                  run(
                    () => blockVendorFromInboxAction(props.vendorOrgId),
                    `${props.vendorName} blocked`
                  );
                }
              }}
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white hover:bg-red-50 px-3 py-1.5 text-sm text-red-700"
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Block vendor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
