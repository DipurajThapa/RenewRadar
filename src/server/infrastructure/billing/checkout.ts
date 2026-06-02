"use server";

import { eq } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import { ForbiddenError, requireRole } from "@server/middleware/rbac";
import { stripe } from "@server/infrastructure/billing/stripe-client";
import { priceIdForTier, type PlanTier } from "@server/infrastructure/billing/plans";

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Creates a Stripe Checkout Session for the given plan tier.
 * Returns the hosted checkout URL — the client redirects there.
 *
 * Side effects:
 *   - Creates a Stripe Customer the first time an account upgrades and
 *     stores the ID on the account row.
 */
export async function createCheckoutSession(input: {
  tier: PlanTier;
}): Promise<CheckoutResult> {
  const { account, user } = await getCurrentAccountAndUser();

  // Initiating checkout commits the account to recurring billing — gate to
  // admin+ so a viewer/member can't sign their company up for $899/mo Pro.
  try {
    requireRole(user, "admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    throw err;
  }

  // Can't checkout into Free Forever or Enterprise from this flow.
  if (input.tier === "free_forever" || input.tier === "enterprise") {
    return {
      ok: false,
      error:
        input.tier === "enterprise"
          ? "Enterprise plans are sold via the sales team — email hello@renewalradar.com"
          : "Free Forever is automatic — no checkout needed",
    };
  }

  const priceId = priceIdForTier(input.tier);
  if (!priceId) {
    return {
      ok: false,
      error: `Stripe price ID not configured for ${input.tier}. Set STRIPE_${input.tier.toUpperCase()}_PRICE_ID in your environment.`,
    };
  }

  // 1. Ensure a Stripe customer exists
  let stripeCustomerId = account.stripeCustomerId;
  if (!stripeCustomerId) {
    try {
      const customer = await stripe.customers.create({
        email: account.billingEmail,
        name: account.name,
        metadata: {
          accountId: account.id,
          createdByUserId: user.id,
        },
      });
      stripeCustomerId = customer.id;
      await db
        .update(accountsTable)
        .set({ stripeCustomerId })
        .where(eq(accountsTable.id, account.id));
    } catch (err) {
      console.error("[checkout] failed to create Stripe customer:", err);
      return { ok: false, error: "Couldn't initialize billing. Please try again." };
    }
  }

  // 2. Create the Checkout Session
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          accountId: account.id,
        },
      },
      success_url: `${appUrl}/settings/billing?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/settings/billing?upgrade=cancelled`,
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: true },
    });

    if (!session.url) {
      return { ok: false, error: "Stripe didn't return a checkout URL" };
    }

    return { ok: true, url: session.url };
  } catch (err) {
    // Don't leak raw Stripe SDK messages to the customer-facing plan card —
    // those expose API key prefixes and internal field names. Log the real
    // detail server-side, return a friendly, generic string.
    const internal = err instanceof Error ? err.message : String(err);
    console.error("[checkout] failed:", internal);
    return {
      ok: false,
      error:
        "We couldn't start checkout. Please try again in a moment — if it keeps failing, contact support.",
    };
  }
}
