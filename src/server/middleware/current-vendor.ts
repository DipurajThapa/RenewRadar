/**
 * T4.10 Slice 1 — Vendor identity middleware.
 *
 * Resolves the current vendor user from the `__rr_vendor_session` cookie.
 * Used by `/vendor/*` routes — DELIBERATELY does NOT call Clerk. The
 * vendor portal lives entirely outside customer Clerk auth.
 *
 * Behavior:
 *   - `requireCurrentVendor()`: returns the vendor session triple
 *     ({ session, vendorUser, vendorOrg }) or redirects to /vendor/sign-in.
 *   - `getCurrentVendor()`: same, but returns null instead of redirecting.
 *     Use this in pages that render differently for signed-out visitors
 *     (e.g. the sign-in page itself, which redirects already-signed-in
 *     users to the dashboard).
 *
 * Session refresh: `validateSession` updates `lastSeenAt` fire-and-forget.
 * We do NOT extend `expiresAt` — sessions are anchored 7d from creation.
 *
 * No demo-mode bypass yet. Slice 2+ can add a `DEMO_VENDOR_*` constant
 * when a demo flow is needed; not worth the surface area for Slice 1.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  validateSession,
  type ValidatedSession,
} from "@server/application/vendor-portal";
import { VENDOR_SESSION_COOKIE } from "@server/application/vendor-portal/internals";

/**
 * Cookie attributes for the vendor session. HttpOnly + SameSite=Lax keeps
 * the token out of JS / cross-site requests; Secure is on in production.
 *
 * Path is "/vendor" so the cookie isn't sent on customer-app requests —
 * tighter audit, and the customer side never accidentally has a vendor
 * token in any request log.
 */
export const VENDOR_COOKIE_BASE_OPTIONS = {
  name: VENDOR_SESSION_COOKIE,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/vendor",
};

/** Per-request cached vendor session resolver. */
export const getCurrentVendor = cache(
  async (): Promise<ValidatedSession | null> => {
    const cookieStore = await cookies();
    const raw = cookieStore.get(VENDOR_SESSION_COOKIE)?.value;
    if (!raw) return null;
    return validateSession(raw);
  }
);

/**
 * For pages that strictly require a signed-in vendor. Redirects to the
 * sign-in page on miss; never throws.
 */
export const requireCurrentVendor = cache(
  async (): Promise<ValidatedSession> => {
    const session = await getCurrentVendor();
    if (!session) {
      redirect("/vendor/sign-in");
    }
    return session;
  }
);
