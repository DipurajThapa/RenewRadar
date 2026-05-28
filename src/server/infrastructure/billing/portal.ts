"use server";

import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { stripe } from "@server/infrastructure/billing/stripe-client";

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Opens Stripe's hosted Customer Portal so the user can:
 *   - Update payment method
 *   - Update billing address
 *   - Switch plans (downgrade/upgrade)
 *   - Cancel subscription
 *   - View past invoices
 *
 * Configure what's available in: Stripe Dashboard → Settings → Billing → Customer Portal.
 */
export async function createPortalSession(): Promise<PortalResult> {
  const { account } = await getCurrentAccountAndUser();

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
