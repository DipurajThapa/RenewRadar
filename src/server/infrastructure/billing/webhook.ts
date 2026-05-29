import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@server/infrastructure/db/client";
import {
  accountsTable,
  documentsTable,
  subscriptionsTable,
  usersTable,
} from "@server/infrastructure/db/schema";
import { planTierForPriceId, type PlanTier } from "@server/infrastructure/billing/plans";
import { createLogger } from "@server/infrastructure/observability/logger";
import { shouldLockForCapacity } from "@server/application/billing/lock-state";

const log = createLogger({ component: "billing.webhook" });

/**
 * Maximum grace days a subscription can sit in `past_due` before we
 * force-downgrade the account to free_forever. Stripe handles dunning
 * inside this window — we just enforce a ceiling so an unpaid customer
 * can't ride a paid tier indefinitely (audit H3).
 */
export const PAST_DUE_GRACE_DAYS = 14;

/**
 * Stripe webhook event router. Maps Stripe events to internal state changes.
 *
 * Idempotency: Stripe may deliver events multiple times. Our handlers must
 * be safe to re-run. The handlers below are all "set to current state from
 * subscription object" which is naturally idempotent.
 *
 * Trust model: we trust Stripe's signed payload (verified at the route
 * handler before this function is called) and the bilateral state in our DB
 * (stripeCustomerId on the Account row, written when checkout starts). We
 * do NOT trust `subscription.metadata` for security-sensitive routing —
 * metadata is mutable from outside the signed webhook flow. See
 * `resolveAccountId` for the routing rules.
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
      log.info("stripe_event_unhandled", { type: event.type });
  }
}

async function syncSubscriptionState(
  subscription: Stripe.Subscription
): Promise<void> {
  const accountId = await resolveAccountId(subscription);
  if (!accountId) {
    // No matching Account row by customer ID. Either the customer was
    // created out-of-band (manual dashboard creation, dev environment) or
    // the checkout flow didn't store the customer ID. Log and bail; do NOT
    // attempt to derive an accountId from metadata — that was the prior
    // revenue-leak vector (REV-2 in the investor audit).
    log.warn("stripe_account_not_found", {
      subscriptionId: subscription.id,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
    });
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    log.warn("stripe_subscription_missing_price", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const resolvedTier = planTierForPriceId(priceId);
  if (resolvedTier === null) {
    // Unknown price ID. Was previously masked by a silent ?? "starter"
    // fallback — that downgraded paying Pro customers to Starter on any env
    // var rotation. Throw loudly so Stripe retries and ops sees the alert
    // in Sentry, rather than overwriting the account's planTier with a
    // wrong value. The webhook route catches errors and returns 500 so
    // Stripe re-delivers per its retry schedule.
    throw new Error(
      `[stripe-webhook] unknown priceId "${priceId}" for subscription ${subscription.id}. ` +
        `Check STRIPE_STARTER_PRICE_ID / STRIPE_GROWTH_PRICE_ID / STRIPE_PRO_PRICE_ID env vars.`
    );
  }

  // Track past-due lifecycle. We set `pastDueSince` the first time we see
  // a past_due event and clear it when the sub returns to active/trialing.
  // The cron `pastDueGraceEnforcement` reads this column daily and forces
  // a downgrade to free_forever for accounts that have been past-due
  // longer than PAST_DUE_GRACE_DAYS.
  let pastDueSince: Date | null | undefined;
  if (subscription.status === "past_due") {
    const [existing] = await db
      .select({ pastDueSince: accountsTable.pastDueSince })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1);
    pastDueSince = existing?.pastDueSince ?? new Date();
  } else if (
    subscription.status === "active" ||
    subscription.status === "trialing"
  ) {
    pastDueSince = null;
  }
  // For other statuses (canceled, unpaid, incomplete_expired) we leave the
  // column alone — handleSubscriptionDeleted explicitly clears it.

  const effectiveTier = effectivePlanTier(subscription.status, resolvedTier);

  // Over-capacity lockdown: if the new tier's caps are below the account's
  // current usage (e.g. Pro→Starter with 500 subs vs 50 cap), flip the
  // lock-state so writes refuse. The next successful write attempt will
  // re-evaluate and clear the lock if the user has cleaned up.
  const [subCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.accountId, accountId));
  const [userCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.accountId, accountId));
  const [storageRow] = await db
    .select({
      bytes: sql<number>`coalesce(sum(${documentsTable.sizeBytes}), 0)::bigint`,
    })
    .from(documentsTable)
    .where(eq(documentsTable.accountId, accountId));

  const overCapacity = shouldLockForCapacity({
    planTier: effectiveTier,
    currentSubscriptions: subCountRow?.count ?? 0,
    currentUsers: userCountRow?.count ?? 0,
    currentStorageBytes: Number(storageRow?.bytes ?? 0),
  });
  const lockState: string | null = overCapacity ? "over_capacity" : null;

  const updates: {
    planTier: PlanTier;
    stripeSubscriptionId: string;
    trialExpiresAt: Date | null;
    pastDueSince?: Date | null;
    lockState?: string | null;
  } = {
    planTier: effectiveTier,
    stripeSubscriptionId: subscription.id,
    trialExpiresAt: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
    lockState,
  };
  if (pastDueSince !== undefined) updates.pastDueSince = pastDueSince;

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
      pastDueSince: null, // clear the grace marker on hard cancel
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
 * Resolve the internal account ID for a Stripe subscription.
 *
 * Lookup is by `stripeCustomerId` ONLY. We do not consult
 * `subscription.metadata.accountId` — metadata is mutable from the Stripe
 * dashboard and (with customer portal extensions) from the customer's own
 * billing portal, making it an unauthenticated input for routing purposes.
 *
 * The bilateral link (Account.stripeCustomerId) is written when checkout
 * starts, inside our own server flow, after auth. That's the trusted edge.
 *
 * Returns null if no matching account exists — caller bails without
 * mutating state.
 */
async function resolveAccountId(
  subscription: Stripe.Subscription
): Promise<string | null> {
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
  // past_due → keep tier in grace; Stripe handles dunning. NOTE: P3.3 will
  //   add a time-bounded grace window so a sub stuck in past_due doesn't
  //   ride a paid tier indefinitely. Today we still keep the resolved tier.
  // canceled / unpaid / incomplete_expired → back to Free Forever
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return resolvedTier;
  }
  if (stripeStatus === "past_due") {
    return resolvedTier;
  }
  return "free_forever";
}
