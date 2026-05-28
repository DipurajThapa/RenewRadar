import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountsTable } from "@/lib/db/schema";
import { planTierForPriceId, type PlanTier } from "@/lib/billing/plans";

/**
 * Stripe webhook event router. Maps Stripe events to internal state changes.
 *
 * Idempotency: Stripe may deliver events multiple times. Our handlers must
 * be safe to re-run. The handlers below are all "set to current state from
 * subscription object" which is naturally idempotent.
 */
export async function processStripeWebhook(
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscriptionState(event.data.object as Stripe.Subscription);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(
        event.data.object as Stripe.Subscription
      );
      break;

    case "invoice.payment_failed":
      handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    case "invoice.payment_succeeded":
      // V1: trust customer.subscription.updated for state. No-op here.
      // V1.5: write a payments log entry.
      break;

    case "checkout.session.completed":
      // Often duplicates customer.subscription.created. Safe to ignore.
      break;

    default:
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
  }
}

async function syncSubscriptionState(
  subscription: Stripe.Subscription
): Promise<void> {
  const accountId = await resolveAccountId(subscription);
  if (!accountId) {
    console.warn(
      `[stripe-webhook] no accountId for subscription ${subscription.id}`
    );
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    console.warn(
      `[stripe-webhook] subscription ${subscription.id} has no price item`
    );
    return;
  }

  const newTier = planTierForPriceId(priceId);
  const effectiveTier = effectivePlanTier(subscription.status, newTier);

  const updates: {
    planTier: PlanTier;
    stripeSubscriptionId: string;
    trialExpiresAt: Date | null;
  } = {
    planTier: effectiveTier,
    stripeSubscriptionId: subscription.id,
    trialExpiresAt: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
  };

  await db
    .update(accountsTable)
    .set(updates)
    .where(eq(accountsTable.id, accountId));
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const accountId = await resolveAccountId(subscription);
  if (!accountId) return;

  await db
    .update(accountsTable)
    .set({
      planTier: "free_forever",
      stripeSubscriptionId: null,
      trialExpiresAt: null,
    })
    .where(eq(accountsTable.id, accountId));
}

function handlePaymentFailed(invoice: Stripe.Invoice): void {
  // V1: log only — Stripe handles dunning emails to the customer.
  // V1.5: write an in-app notification so the customer sees a banner.
  console.warn(
    `[stripe-webhook] payment failed for invoice ${invoice.id} (subscription ${
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id ?? "n/a"
    })`
  );
}

/**
 * Look up the internal account ID for a Stripe subscription.
 * Tries metadata first, falls back to customer ID match.
 */
async function resolveAccountId(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.accountId;
  if (fromMetadata) return fromMetadata;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (!customerId) return null;

  const rows = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(eq(accountsTable.stripeCustomerId, customerId))
    .limit(1);

  return rows[0]?.id ?? null;
}

function effectivePlanTier(
  stripeStatus: Stripe.Subscription.Status,
  resolvedTier: PlanTier
): PlanTier {
  // active or trialing → use the resolved tier
  // past_due → keep tier in grace; Stripe handles dunning
  // canceled / unpaid / incomplete_expired → back to Free Forever
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return resolvedTier;
  }
  if (stripeStatus === "past_due") {
    return resolvedTier;
  }
  return "free_forever";
}
