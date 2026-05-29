"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  staffReinstateVendorAction,
  staffSuspendVendorAction,
  staffVerifyVendorDomainAction,
} from "@app/staff/actions";

/**
 * T4.10 Slice 6 — staff trust controls for one vendor org.
 * Amber-styled to match the staff console.
 */
export function VendorAdminActions({
  vendorOrgId,
  status,
  domainVerified,
}: {
  vendorOrgId: string;
  status: string;
  domainVerified: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function verify() {
    const note = prompt("Manual verification note (why are you verifying this domain?)");
    if (note === null) return;
    startTransition(async () => {
      await staffVerifyVendorDomainAction({ vendorOrgId, note });
      router.refresh();
    });
  }

  function suspend() {
    const reason = prompt("Reason for suspending this vendor?");
    if (!reason) return;
    startTransition(async () => {
      await staffSuspendVendorAction({ vendorOrgId, reason });
      router.refresh();
    });
  }

  function reinstate() {
    startTransition(async () => {
      await staffReinstateVendorAction(vendorOrgId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {!domainVerified && status !== "suspended" && status !== "archived" && (
        <button
          type="button"
          onClick={verify}
          disabled={pending}
          className="rounded border border-amber-300 bg-white hover:bg-amber-50 px-2 py-1 text-xs text-amber-900"
        >
          Verify manually
        </button>
      )}
      {status === "suspended" ? (
        <button
          type="button"
          onClick={reinstate}
          disabled={pending}
          className="rounded border border-amber-300 bg-white hover:bg-amber-50 px-2 py-1 text-xs text-amber-900"
        >
          Reinstate
        </button>
      ) : (
        status !== "archived" && (
          <button
            type="button"
            onClick={suspend}
            disabled={pending}
            className="rounded border border-red-300 bg-white hover:bg-red-50 px-2 py-1 text-xs text-red-700"
          >
            Suspend
          </button>
        )
      )}
    </div>
  );
}
