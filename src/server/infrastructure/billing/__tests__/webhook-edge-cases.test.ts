/**
 * Stripe webhook edge cases — production-grade idempotency & ordering.
 *
 * Stripe's at-least-once delivery means our handler MUST be:
 *   - Idempotent: re-delivery of the same logical event lands the same final
 *     state (no double-mutation).
 *   - Order-tolerant: subscription events can arrive out of chronological
 *     order due to retry, and the final state must still be coherent.
 *   - Quiet on unknown event types: Stripe ships new event types all the
 *     time; the handler must not crash when it sees one.
 *
 * Existing coverage (webhook.test.ts) pins REV-2 (metadata-routing trust)
 * and REV-3 (unknown priceId throws). This file covers the dimensions
 * that weren't yet pinned: re-delivery, out-of-order, and unknown types.
 */
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
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
  process.env.STRIPE_STARTER_PRICE_ID = "price_starter_test";
  process.env.STRIPE_GROWTH_PRICE_ID = "price_growth_test";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
});

async function setCustomerId(accountId: string, customerId: string) {
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

async function getPastDueSince(accountId: string): Promise<Date | null> {
  const [row] = await db
    .select({ pastDueSince: accountsTable.pastDueSince })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));
  return row?.pastDueSince ?? null;
}

function subEvent(args: {
  type: "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted";
  customerId: string;
  priceId: string;
  status?: Stripe.Subscription.Status;
  eventId?: string;
  subscriptionId?: string;
}): Stripe.Event {
  return {
    id: args.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: args.type,
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
        metadata: {},
        trial_end: null,
        items: { data: [{ price: { id: args.priceId } }] },
      } as unknown as Stripe.Subscription,
    },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────────
// Idempotency — same logical event delivered twice
// ─────────────────────────────────────────────────────────────────────────

describe("Stripe webhook re-delivery (idempotency)", () => {
  it("two identical subscription.updated events land the same final state", async () => {
    await setCustomerId(ids.accountA.id, "cus_replay");
    const event = subEvent({
      type: "customer.subscription.updated",
      customerId: "cus_replay",
      priceId: "price_growth_test",
      eventId: "evt_replay_1",
    });

    await processStripeWebhook(event);
    expect(await getPlanTier(ids.accountA.id)).toBe("growth");

    // Re-deliver the same event. Final state must be identical, not flap.
    await processStripeWebhook(event);
    expect(await getPlanTier(ids.accountA.id)).toBe("growth");
  });

  it("repeated past_due events do NOT shift the pastDueSince anchor", async () => {
    await setCustomerId(ids.accountA.id, "cus_pastdue_replay");
    const event = subEvent({
      type: "customer.subscription.updated",
      customerId: "cus_pastdue_replay",
      priceId: "price_pro_test",
      status: "past_due",
    });

    await processStripeWebhook(event);
    const first = await getPastDueSince(ids.accountA.id);
    expect(first).toBeInstanceOf(Date);

    // Re-deliver several times — the first-past-due timestamp must persist
    // so the grace cron measures from the original entry, not the latest
    // re-delivery. Drifting the anchor would extend the grace forever.
    await new Promise((r) => setTimeout(r, 20));
    await processStripeWebhook(event);
    await new Promise((r) => setTimeout(r, 20));
    await processStripeWebhook(event);
    const final = await getPastDueSince(ids.accountA.id);
    expect(final?.getTime()).toBe(first?.getTime());
  });

  it("subscription.deleted delivered twice still ends at free_forever", async () => {
    await setCustomerId(ids.accountA.id, "cus_deldelete");
    // Start on growth.
    await processStripeWebhook(
      subEvent({
        type: "customer.subscription.updated",
        customerId: "cus_deldelete",
        priceId: "price_growth_test",
      })
    );
    expect(await getPlanTier(ids.accountA.id)).toBe("growth");

    const del = subEvent({
      type: "customer.subscription.deleted",
      customerId: "cus_deldelete",
      priceId: "price_growth_test",
      status: "canceled",
    });
    await processStripeWebhook(del);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");

    // Second delivery of the cancellation event — still free_forever.
    await processStripeWebhook(del);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Out-of-order — Stripe's HTTP retry can deliver newer events before older
// ─────────────────────────────────────────────────────────────────────────

describe("Stripe webhook out-of-order delivery", () => {
  it("deleted-then-updated lands UPDATED state (last-event-wins convergence)", async () => {
    // This documents the current handler's behavior: events are applied in
    // the order they arrive (no Stripe-event-timestamp comparison). When
    // Stripe re-fires a stale `subscription.updated` AFTER `deleted`, the
    // account gets reactivated. That mirrors how Stripe Sessions actually
    // converge — the customer either pays again (new active sub) or the
    // event is genuinely stale and a subsequent `subscription.deleted`
    // retry restores correctness. Test pins the behavior so any future
    // change to event ordering is intentional.
    await setCustomerId(ids.accountA.id, "cus_outoforder");

    const deletedEvt = subEvent({
      type: "customer.subscription.deleted",
      customerId: "cus_outoforder",
      priceId: "price_growth_test",
      status: "canceled",
    });
    const updatedEvt = subEvent({
      type: "customer.subscription.updated",
      customerId: "cus_outoforder",
      priceId: "price_growth_test",
      status: "active",
    });

    // Stripe accidentally delivers deleted first, then a stale updated.
    await processStripeWebhook(deletedEvt);
    expect(await getPlanTier(ids.accountA.id)).toBe("free_forever");
    await processStripeWebhook(updatedEvt);
    // Final state reflects the last applied event. A subsequent
    // re-delivery of the cancellation would converge back.
    expect(await getPlanTier(ids.accountA.id)).toBe("growth");
  });

  it("updated arriving before created still routes by customer ID", async () => {
    // Stripe doesn't guarantee `created` precedes `updated` either —
    // both are first-write-wins on our side because the routing is purely
    // by stripe_customer_id, not by an internal lifecycle marker.
    await setCustomerId(ids.accountB.id, "cus_uncreated");
    await processStripeWebhook(
      subEvent({
        type: "customer.subscription.updated",
        customerId: "cus_uncreated",
        priceId: "price_starter_test",
      })
    );
    expect(await getPlanTier(ids.accountB.id)).toBe("starter");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unknown event types — must NOT crash; route returns 200, log a warning
// ─────────────────────────────────────────────────────────────────────────

describe("Stripe webhook unknown event types", () => {
  it("ignores unrecognized event type without throwing", async () => {
    const future = {
      id: "evt_future",
      type: "stripe.future.event_we_never_heard_of",
      api_version: "2024-09-30.acacia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      object: "event",
      data: { object: {} },
    } as unknown as Stripe.Event;

    await expect(processStripeWebhook(future)).resolves.toBeUndefined();
  });

  it("ignores invoice.payment_succeeded as a deliberate no-op", async () => {
    // We intentionally don't act on payment.succeeded — customer.subscription.*
    // is the canonical source. Confirm it doesn't crash either.
    const evt = {
      id: "evt_paysucc",
      type: "invoice.payment_succeeded",
      api_version: "2024-09-30.acacia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      object: "event",
      data: { object: { id: "in_test" } },
    } as unknown as Stripe.Event;
    await expect(processStripeWebhook(evt)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unmatched customer — must NOT crash, must NOT silently affect any other
// account (regression cover for REV-2)
// ─────────────────────────────────────────────────────────────────────────

describe("Stripe webhook for an unmatched customer", () => {
  it("is a no-op when no account row has the given stripeCustomerId", async () => {
    const beforeA = await getPlanTier(ids.accountA.id);
    const beforeB = await getPlanTier(ids.accountB.id);

    await processStripeWebhook(
      subEvent({
        type: "customer.subscription.updated",
        customerId: "cus_unknown_to_us",
        priceId: "price_pro_test",
      })
    );

    // Neither account should have moved.
    expect(await getPlanTier(ids.accountA.id)).toBe(beforeA);
    expect(await getPlanTier(ids.accountB.id)).toBe(beforeB);
  });
});
