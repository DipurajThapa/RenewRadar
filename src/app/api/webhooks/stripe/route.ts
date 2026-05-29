import { stripe } from "@server/infrastructure/billing/stripe-client";
import { processStripeWebhook } from "@server/infrastructure/billing/webhook";
import { createLogger } from "@server/infrastructure/observability/logger";

// Stripe signature verification needs the raw request body, so this route
// must run on the Node runtime and we must read with `req.text()`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ component: "webhooks.stripe" });

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error("stripe_webhook_secret_unset");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Read headers from the Request directly rather than `next/headers()` so
  // the route is unit-testable by passing a synthetic Request — the
  // `next/headers` helper requires an active Next request scope and can't
  // be called from a test or another non-route caller.
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    log.warn("stripe_signature_verification_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      `Invalid signature: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 400 }
    );
  }

  try {
    await processStripeWebhook(event);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    log.error("stripe_processing_failed", err, { eventType: event.type });
    return new Response(
      `Processing error: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 500 }
    );
  }
}
