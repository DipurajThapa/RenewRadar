"use server";

/**
 * T4.10 Slice 3 — vendor-side connection decisions.
 *
 * RBAC: gated by `requireCurrentVendor`; the connection must belong to the
 * caller's vendor_org (enforced in the application layer via the vendorOrgId
 * predicate). Exempt from customer-side RBAC/audit coverage via the
 * `src/app/vendor/` prefix.
 */
import { revalidatePath } from "next/cache";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import {
  acceptConnection,
  declineConnection,
  VendorConnectionError,
} from "@server/application/vendor-portal/connections";

export type DecisionResult = { ok: true } | { ok: false; error: string };

export async function acceptConnectionAction(
  connectionId: string
): Promise<DecisionResult> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  try {
    await acceptConnection({
      connectionId,
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
    });
    revalidatePath("/vendor/connections");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorConnectionError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function declineConnectionAction(
  connectionId: string
): Promise<DecisionResult> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  try {
    await declineConnection({
      connectionId,
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
    });
    revalidatePath("/vendor/connections");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorConnectionError) return { ok: false, error: err.message };
    throw err;
  }
}
