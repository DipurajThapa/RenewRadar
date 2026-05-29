"use server";

import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { stripe } from "@server/infrastructure/billing/stripe-client";

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Opens Stripe's hosted Customer Portal so an admin can:
 *   - Update payment method
 *   - Update billing address
 *   - Switch plans (downgrade/upgrade)
 *   - Cancel subscription
 *   - View past invoices
 *
 * Restricted to admin+ — the portal exposes plan switching and cancellation,
 * which are owner-grade concerns. A viewer or member could otherwise
 * downgrade their company's plan from the billing settings page. The check
 * mirrors the role floor on team invitations and integrations.
 *
 * Configure what's available in: Stripe Dashboard → Settings → Billing → Customer Portal.
 */
export async function createPortalSession(): Promise<PortalResult> {
  const { account, user } = await getCurrentAccountAndUser();
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  if (!account.stripeCustomerId) {
    return {
      ok: false,
      error: "No Stripe customer yet — start a paid plan first.",
    };
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${appUrl}/settings/billing`,
    });
    return { ok: true, url: session.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[portal] failed:", msg);
    return { ok: false, error: msg };
  }
}
