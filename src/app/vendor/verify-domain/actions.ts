"use server";

/**
 * T4.10 Slice 2 — vendor domain verification actions.
 *
 * RBAC: gated by `requireCurrentVendor` (vendor portal session). Exempt from
 * the customer-side RBAC + audit coverage tests for the same reason as the
 * other /vendor actions — there is no customer user in scope and audit goes
 * to vendor_audit_log via the application module.
 */
import { revalidatePath } from "next/cache";
import { requireCurrentVendor } from "@server/middleware/current-vendor";
import {
  checkDomainVerification,
  startDomainVerification,
  DomainVerificationError,
} from "@server/application/vendor-portal/domain-verification";

export type StartResult =
  | { ok: true; host: string; expectedValue: string; alreadyVerified: boolean }
  | { ok: false; error: string };

export async function startVerificationAction(): Promise<StartResult> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  try {
    const r = await startDomainVerification({
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
    });
    revalidatePath("/vendor/verify-domain");
    return {
      ok: true,
      host: r.host,
      expectedValue: r.expectedValue,
      alreadyVerified: r.alreadyVerified,
    };
  } catch (err) {
    if (err instanceof DomainVerificationError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

export type CheckResult =
  | { ok: true; verified: boolean; observed: string[] }
  | { ok: false; error: string };

export async function checkVerificationAction(): Promise<CheckResult> {
  const { vendorOrg, vendorUser } = await requireCurrentVendor();
  try {
    const r = await checkDomainVerification({
      vendorOrgId: vendorOrg.id,
      vendorUserId: vendorUser.id,
    });
    revalidatePath("/vendor/verify-domain");
    revalidatePath("/vendor/dashboard");
    return { ok: true, verified: r.verified, observed: r.observed };
  } catch (err) {
    if (err instanceof DomainVerificationError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
