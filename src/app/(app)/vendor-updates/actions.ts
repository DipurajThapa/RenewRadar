"use server";

/**
 * T4.10 Slice 5 — customer-side vendor inbox actions.
 *
 * RBAC: member+ can triage vendor updates (accept/dismiss). Blocking a vendor
 * is a heavier action — admin+ — and is reused from the vendors actions
 * (`blockVendorConnectionAction`). These actions import `requireRole`.
 */
import { revalidatePath } from "next/cache";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import {
  acceptVendorUpdate,
  dismissVendorUpdate,
  markVendorUpdateRead,
  reportVendorUpdate,
  VendorInboxError,
} from "@server/application/vendor-portal/customer-inbox";
import { blockVendor } from "@server/application/vendor-portal/connections";

export type InboxResult = { ok: true } | { ok: false; error: string };

export async function acceptVendorUpdateAction(
  deliveryId: string
): Promise<InboxResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await acceptVendorUpdate({ accountId: account.id, deliveryId, userId: user.id });
    revalidatePath("/vendor-updates");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorInboxError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function dismissVendorUpdateAction(
  deliveryId: string
): Promise<InboxResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await dismissVendorUpdate({ accountId: account.id, deliveryId, userId: user.id });
    revalidatePath("/vendor-updates");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorInboxError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function markVendorUpdateReadAction(
  deliveryId: string
): Promise<InboxResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  await markVendorUpdateRead({ accountId: account.id, deliveryId });
  revalidatePath("/vendor-updates");
  return { ok: true };
}

/** Report an update as spam / inappropriate. member+ — flags it for staff. */
export async function reportVendorUpdateAction(input: {
  deliveryId: string;
  reason: string;
}): Promise<InboxResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "member");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  try {
    await reportVendorUpdate({
      accountId: account.id,
      deliveryId: input.deliveryId,
      userId: user.id,
      reason: input.reason,
    });
    revalidatePath("/vendor-updates");
    return { ok: true };
  } catch (err) {
    if (err instanceof VendorInboxError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Block the vendor that sent this update. admin+ only. */
export async function blockVendorFromInboxAction(
  vendorOrgId: string
): Promise<InboxResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }
  await blockVendor({ accountId: account.id, vendorOrgId, userId: user.id });
  revalidatePath("/vendor-updates");
  return { ok: true };
}
