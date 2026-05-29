/**
 * Webhook signature verification tests.
 *
 * Audit gap C3: pre-fix, signature verification at the route boundary was
 * 100% untested. An invalid-signature replay test and a missing-header
 * rejection test are table-stakes for any payment/identity integration.
 * Both routes mutate identity/billing state, so a bypass would be fatal.
 *
 * We test the actual `POST` handlers (not internal helpers) so the test
 * proves the wired-up behavior end-to-end, not just an extracted helper.
 *
 * Covered:
 *   - Stripe webhook rejects requests with no `stripe-signature` header
 *   - Stripe webhook rejects forged signatures
 *   - Stripe webhook accepts a valid signature (constructEvent succeeds)
 *   - Clerk webhook rejects missing svix headers
 *   - Clerk webhook rejects invalid svix signatures
 *   - Both return clean 500 when the secret env var is missing
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// Mock the email + analytics transitive deps before importing the route
// handlers. The route imports provision.ts which imports a React Email
// `.tsx` template — the vite test runner can't parse JSX out of the box.
// We don't exercise email rendering here (signature verification is the
// boundary under test), so no-op stubs are correct.
vi.mock("@server/infrastructure/email/templates/welcome", () => ({
  renderWelcomeEmail: vi.fn().mockResolvedValue("<html />"),
}));
vi.mock("@server/infrastructure/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@server/infrastructure/analytics", () => ({
  identifyUser: vi.fn(),
  recordEvent: vi.fn(),
}));

import { POST as stripeWebhookPost } from "@app/api/webhooks/stripe/route";
import { POST as clerkWebhookPost } from "@app/api/webhooks/clerk/route";
import {
  ensureMigrated,
  truncateAll,
} from "@server/infrastructure/db/__tests__/test-harness";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await truncateAll();
});

// ─────────────────────────────────────────────────────────────────────────
// Stripe webhook
// ─────────────────────────────────────────────────────────────────────────

const TEST_STRIPE_SECRET = "whsec_test_secret_for_unit_tests";

/**
 * Build a Stripe-style `stripe-signature` header for a given body, secret,
 * and timestamp. Mirrors what Stripe sends in real webhook deliveries.
 * Format: `t=<timestamp>,v1=<hmac-sha256>`.
 */
function buildStripeSig(args: {
  body: string;
  secret: string;
  timestampSec?: number;
}): string {
  const ts = args.timestampSec ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${args.body}`;
  const signature = createHmac("sha256", args.secret)
    .update(signedPayload)
    .digest("hex");
  return `t=${ts},v1=${signature}`;
}

function makeStripeRequest(args: {
  body: string;
  signature?: string;
}): Request {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (args.signature !== undefined) {
    headers.set("stripe-signature", args.signature);
  }
  return new Request("https://example.test/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: args.body,
  });
}

describe("Stripe webhook signature verification", () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const req = makeStripeRequest({ body: '{"id":"evt_1"}' });
    const res = await stripeWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when stripe-signature is forged (wrong secret)", async () => {
    const body = JSON.stringify({
      id: "evt_attack",
      type: "customer.subscription.updated",
    });
    const forged = buildStripeSig({
      body,
      secret: "whsec_NOT_THE_REAL_SECRET",
    });
    const req = makeStripeRequest({ body, signature: forged });
    const res = await stripeWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when stripe-signature timestamp is too old (replay window)", async () => {
    // Stripe rejects signatures older than ~5 minutes (default tolerance).
    // We sign a body with a year-old timestamp and assert rejection.
    const body = JSON.stringify({
      id: "evt_old",
      type: "customer.subscription.updated",
    });
    const oneYearAgoSec = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
    const oldSig = buildStripeSig({
      body,
      secret: TEST_STRIPE_SECRET,
      timestampSec: oneYearAgoSec,
    });
    const req = makeStripeRequest({ body, signature: oldSig });
    const res = await stripeWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 (server-misconfigured) when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const req = makeStripeRequest({
      body: '{"id":"evt"}',
      signature: "t=1,v1=anything",
    });
    const res = await stripeWebhookPost(req);
    expect(res.status).toBe(500);
  });

  it("accepts a request with a valid signature (passes the signature check)", async () => {
    // We don't care about the response status of the inner handler — we
    // only care that the signature check passed, i.e. the response is NOT
    // 400 "Invalid signature". A subsequent processing error (e.g. unknown
    // event type) returns 200/500 but the signature was honored.
    const body = JSON.stringify({
      id: "evt_legit",
      type: "ping", // unhandled event → falls through to default log + 200
      api_version: "2024-09-30.acacia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: { object: {} },
    });
    const sig = buildStripeSig({ body, secret: TEST_STRIPE_SECRET });
    const req = makeStripeRequest({ body, signature: sig });
    const res = await stripeWebhookPost(req);
    // The signature check passed if we did NOT get a 400 "Invalid signature".
    // The route returns 200 for unhandled event types.
    expect(res.status).not.toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Clerk webhook
// ─────────────────────────────────────────────────────────────────────────

// svix accepts secrets in `whsec_<base64>` format. This is a publicly-known
// test fixture value (see svix docs).
const TEST_CLERK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

function makeClerkRequest(args: {
  body: string;
  svixId?: string | null;
  svixTimestamp?: string | null;
  svixSignature?: string | null;
}): Request {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (args.svixId !== null && args.svixId !== undefined) {
    headers.set("svix-id", args.svixId);
  }
  if (args.svixTimestamp !== null && args.svixTimestamp !== undefined) {
    headers.set("svix-timestamp", args.svixTimestamp);
  }
  if (args.svixSignature !== null && args.svixSignature !== undefined) {
    headers.set("svix-signature", args.svixSignature);
  }
  return new Request("https://example.test/api/webhooks/clerk", {
    method: "POST",
    headers,
    body: args.body,
  });
}

describe("Clerk webhook signature verification", () => {
  const originalSecret = process.env.CLERK_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = TEST_CLERK_SECRET;
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
    else process.env.CLERK_WEBHOOK_SECRET = originalSecret;
  });

  it("returns 400 when svix-id header is missing", async () => {
    const req = makeClerkRequest({
      body: '{"type":"user.created"}',
      svixId: null,
      svixTimestamp: "1700000000",
      svixSignature: "v1,anything",
    });
    const res = await clerkWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when svix-timestamp header is missing", async () => {
    const req = makeClerkRequest({
      body: '{"type":"user.created"}',
      svixId: "msg_test",
      svixTimestamp: null,
      svixSignature: "v1,anything",
    });
    const res = await clerkWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when svix-signature header is missing", async () => {
    const req = makeClerkRequest({
      body: '{"type":"user.created"}',
      svixId: "msg_test",
      svixTimestamp: "1700000000",
      svixSignature: null,
    });
    const res = await clerkWebhookPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when svix-signature is forged", async () => {
    const req = makeClerkRequest({
      body: '{"type":"user.created"}',
      svixId: "msg_test",
      svixTimestamp: String(Math.floor(Date.now() / 1000)),
      svixSignature: "v1,definitely-not-a-real-signature",
    });
    const res = await clerkWebhookPost(req);
    expect(res.status).toBe(401);
  });

  it("returns 500 when CLERK_WEBHOOK_SECRET is unset", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const req = makeClerkRequest({
      body: '{"type":"user.created"}',
      svixId: "msg_test",
      svixTimestamp: "1700000000",
      svixSignature: "v1,anything",
    });
    const res = await clerkWebhookPost(req);
    expect(res.status).toBe(500);
  });
});
