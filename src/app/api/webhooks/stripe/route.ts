import { headers } from "next/headers";
import { stripe } from "@server/infrastructure/billing/stripe-client";
import { processStripeWebhook } from "@server/infrastructure/billing/webhook";

// Stripe signature verification needs the raw request body, so this route
// must run on the Node runtime and we must read with `req.text()`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = (await headers()).get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[stripe-webhook] signature verification failed:", msg);
    return new Response(`Invalid signature: ${msg}`, { status: 400 });
  }

  try {
    await processStripeWebhook(event);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(
      `[stripe-webhook] processing failed for ${event.type}:`,
      msg
    );
    // 5xx triggers Stripe to retry; 2xx acks.
    return new Response(`Processing error: ${msg}`, { status: 500 });
  }
}
