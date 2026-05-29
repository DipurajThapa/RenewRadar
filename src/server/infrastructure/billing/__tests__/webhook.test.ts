/**
 * Stripe webhook trust-model tests.
 *
 * Covers the two REV-class findings from the investor audit:
 *
 *   REV-2: `subscription.metadata.accountId` is ignored. Account routing is
 *          exclusively by `stripeCustomerId` ↔ `accountsTable.stripeCustomerId`.
 *          A spoofed metadata accountId must NOT update any account.
 *
 *   REV-3: An unknown `priceId` must throw rather than silently default to
 *          starter (which previously downgraded paying Pro customers).
 *
 * Signature verification is enforced by the route handler before this
 * function is called — covered by the webhooks signature replay test in P4.3.
 * Here we test the post-verification routing.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@server/infrastructure/db/client";
import { accountsTable } from "@server/infrastructure/db/schema";
import {
  ensureMigrated,
  seedTwoAccounts,
  truncateAll,
  type SeedTwoAccountsResult,
} from "@server/infrastructure/db/__tests__/test-harness";
import { processStripeWebhook } from "@server/infrastructure/billing/webhook";

let ids: SeedTwoAccountsResult;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
  ids = await seedTwoAccounts();

  // Pin price-ID env vars so the webhook can resolve them deterministically.
  process.env.STRIPE_STARTER_PRICE_ID = "price_starter_test";
  process.env.STRIPE_GROWTH_PRICE_ID = "price_growth_test";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function setCustomerId(
  accountId: string,
  customerId: string
): Promise<void> {
  await db
    .update(accountsTable)
    .set({ stripeCustomerId: customerId })
    .where(eq(accountsTable.id, accountId));
}

async function getPlanTier(accountId: string): Promise<string> {
  const [row] = await db
    .select({ planTier: accountsTable.planTier })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  return row?.planTier ?? "missing";
}

function makeSubscriptionEvent(args: {
  customerId: string;
  priceId: string;
  status?: Stripe.Subscription.Status;
  metadata?: Record<string, string>;
  type?: "customer.subscription.created" | "customer.subscription.updated";
  subscriptionId?: string;
  trialEnd?: number | null;
}): Stripe.Event {
  // Minimal shape — we only depend on the fields the handler reads.
  return {
    id: "evt_test",
    type: args.type ?? "customer.subscription.updated",
    api_version: "2024-09-30.acacia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: {
        id: args.subscriptionId ?? "sub_test",
        customer: args.customerId,
        status: args.status ?? "active",
        metadata: args.metadata ?? {},
        trial_end: args.trialEnd ?? null,
        items: {
          data: [{ price: { id: args.priceId } }],
        },
      } as unknown as Stripe.Subscription,
    },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────────
// REV-2: metadata is no longer trusted for routing
// ─────────────────────────────────────────────────────────────────────────

describe("processStripeWebhook — accountId routing (REV-2)", () => {
  it("ignores subscription.metadata.accountId entirely", async () => {
    // Attacker's setup: they own a Stripe customer linked to Account B.
    // They set metadata.accountId to Account A's ID. Without the fix, this
    // would flip Account A's planTier on every subscription.updated.
    await setCustomerId(ids.accountB.id, "cus_attacker");

    const evt = makeSubscriptionEvent({
      customerId: "cus_attacker",
      priceId: "price_pro_test",
      metadata: { accountId: ids.accountA.id }, // <-- the spoofed routing
    });

    await processStripeWebhook(evt);

    // Account A must be untouched (still on whatever tier it started on).
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
    // Account B (the actual subscription owner) gets the tier update.
    expect(await getPlanTier(ids.accountB.id)).toBe("pro");
  });

  it("ignores the event entirely when no Account matches the customerId", async () => {
    // No setCustomerId — neither account is linked to "cus_unknown".
    const evt = makeSubscriptionEvent({
      customerId: "cus_unknown",
      priceId: "price_starter_test",
      metadata: { accountId: ids.accountA.id }, // metadata also ignored
    });

    await processStripeWebhook(evt);

    // Nothing changed anywhere.
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
    expect(await getPlanTier(ids.accountB.id)).toBe("free_forever");
  });

  it("routes correctly when customerId matches an Account", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_growth_test",
    });
    await processStripeWebhook(evt);
    expect(await getPlanTier(ids.accountA.id)).toBe("growth");
    expect(await getPlanTier(ids.accountB.id)).toBe("free_forever");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// REV-3: unknown priceId throws rather than silently defaulting
// ─────────────────────────────────────────────────────────────────────────

describe("processStripeWebhook — unknown priceId (REV-3)", () => {
  it("throws on a priceId that doesn't match any configured tier", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_typo_or_rotated",
    });

    await expect(processStripeWebhook(evt)).rejects.toThrow(
      /unknown priceId "price_typo_or_rotated"/
    );

    // The account is not partially updated — planTier stays put.
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
  });

  it("throws even when subscription has trial_end set", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_garbage",
      trialEnd: Math.floor(Date.now() / 1000) + 14 * 86400,
    });
    await expect(processStripeWebhook(evt)).rejects.toThrow(/unknown priceId/);
  });

  it("does NOT silently default to starter for an unrecognized priceId", async () => {
    // The pre-fix behaviour: ?? "starter" would have flipped a Pro paying
    // customer down to Starter on env-var rotation. We guard against
    // regression here: even if the account WAS on pro, an unknown price
    // never writes "starter".
    await db
      .update(accountsTable)
      .set({ stripeCustomerId: "cus_legit_a", planTier: "pro" })
      .where(eq(accountsTable.id, ids.accountA.id));

    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_rotated_yesterday",
    });
    await expect(processStripeWebhook(evt)).rejects.toThrow(/unknown priceId/);
    // Pro stays pro — webhook never partially-wrote a downgrade.
    expect(await getPlanTier(ids.accountA.id)).toBe("pro");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Happy paths + subscription deletion
// ─────────────────────────────────────────────────────────────────────────

describe("processStripeWebhook — subscription lifecycle", () => {
  it("customer.subscription.deleted resets the account to free_forever", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    await db
      .update(accountsTable)
      .set({ planTier: "pro", stripeSubscriptionId: "sub_existing" })
      .where(eq(accountsTable.id, ids.accountA.id));

    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_pro_test",
      type: "customer.subscription.updated",
    });
    (evt as unknown as { type: string }).type = "customer.subscription.deleted";

    await processStripeWebhook(evt);

    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
  });

  it("status=past_due keeps the resolved tier (grace period)", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_pro_test",
      status: "past_due",
    });
    await processStripeWebhook(evt);
    // P3.3 will bound this with a time-based grace window.
    expect(await getPlanTier(ids.accountA.id)).toBe("pro");
  });

  it("status=canceled forces free_forever even on a paid priceId", async () => {
    await setCustomerId(ids.accountA.id, "cus_legit_a");
    const evt = makeSubscriptionEvent({
      customerId: "cus_legit_a",
      priceId: "price_pro_test",
      status: "canceled",
    });
    await processStripeWebhook(evt);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
  });

  it("unhandled event types are ignored without throwing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const evt = {
        type: "customer.created",
        data: { object: {} },
      } as unknown as Stripe.Event;
      await expect(processStripeWebhook(evt)).resolves.toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });
});
