"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Link2, ShieldOff } from "lucide-react";
import { useToast } from "@ui/hooks/use-toast";
import {
  blockVendorConnectionAction,
  requestVendorConnectionAction,
} from "@app/(app)/vendors/actions";

type Status = "none" | "pending" | "connected" | "declined" | "blocked";

/**
 * T4.10 Slice 3 — customer-side connection control on the vendor detail page.
 * Only renders when a verified vendor_org matches this vendor (the server
 * decides that and passes `matched`).
 */
export function VendorConnectionCard({
  customerVendorId,
  vendorOrgId,
  vendorDisplayName,
  matchedBy,
  status,
}: {
  customerVendorId: string;
  vendorOrgId: string;
  vendorDisplayName: string;
  matchedBy: "domain" | "name";
  status: Status;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function connect() {
    startTransition(async () => {
      const r = await requestVendorConnectionAction(customerVendorId);
      if (!r.ok) {
        toast({ title: "Couldn't connect", description: r.error });
        return;
      }
      router.refresh();
      toast({
        title: "Connection requested",
        description: `${vendorDisplayName} will be notified to accept.`,
      });
    });
  }

  function block() {
    if (
      !confirm(
        `Block ${vendorDisplayName}? They won't be able to send you renewal or price-change notices on Renewal Radar.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await blockVendorConnectionAction({ vendorOrgId, customerVendorId });
      if (!r.ok) {
        toast({ title: "Couldn't block", description: r.error });
        return;
      }
      router.refresh();
      toast({ title: `${vendorDisplayName} blocked` });
    });
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-teal-700" />
        <span className="text-sm font-semibold text-teal-900">
          {vendorDisplayName} is on Renewal Radar
        </span>
        <span className="text-[10px] uppercase tracking-wide text-teal-700/70">
          verified · matched by {matchedBy}
        </span>
      </div>

      {status === "connected" ? (
        <p className="text-sm text-teal-900/80">
          You&apos;re connected. {vendorDisplayName} can send renewal reminders
          and price-change notices straight to your vendor updates inbox. You
          stay in control — accept or dismiss each one.
        </p>
      ) : status === "pending" ? (
        <p className="text-sm text-teal-900/80">
          Connection requested — waiting for {vendorDisplayName} to accept.
        </p>
      ) : status === "blocked" ? (
        <p className="text-sm text-teal-900/80">
          You&apos;ve blocked {vendorDisplayName}. They can&apos;t send you
          notices. Reconnect anytime.
        </p>
      ) : (
        <p className="text-sm text-teal-900/80">
          Connect to get renewal reminders and price-change notices from{" "}
          {vendorDisplayName} directly. Renewal Radar never shares your team&apos;s
          email addresses with vendors.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(status === "none" || status === "declined" || status === "blocked") && (
          <button
            type="button"
            onClick={connect}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-sm font-medium"
          >
            <Link2 className="h-3.5 w-3.5" />
            {pending ? "…" : "Connect"}
          </button>
        )}
        {status !== "blocked" && (
          <button
            type="button"
            onClick={block}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-teal-300 bg-white hover:bg-teal-50 px-3 py-1.5 text-sm text-teal-900"
          >
            <ShieldOff className="h-3.5 w-3.5" />
            Block
          </button>
        )}
      </div>
    </div>
  );
}
