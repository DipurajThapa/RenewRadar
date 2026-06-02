import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // We don't throw at import time (would break tests, edge runtimes that lazy-load).
  // The first actual API call will fail with a clear message instead.
  console.warn("[stripe] STRIPE_SECRET_KEY not set — billing flows will fail");
}

// Lazy-init via Proxy. `new Stripe("")` THROWS at construction in stripe@17
// ('Neither apiKey nor config.authenticator provided') — eager top-level
// instantiation broke every test file in CI that transitively imports a
// webhook route, where STRIPE_SECRET_KEY is unset. Defer construction to
// first property access so the import is always safe; the actual API call
// still fails fast (with the SDK's real error) if the key is missing at
// use-time, exactly as the comment above intends.
let cached: Stripe | null = null;
function getStripe(): Stripe {
  if (cached) return cached;
  // The SDK rejects an empty string at construction. Fall back to a clearly
  // bogus placeholder so the instance can be built — any actual API call
  // still fails fast with Stripe's real auth error, but signature-only paths
  // (stripe.webhooks.constructEvent — pure HMAC, no auth) still work, which
  // is what the webhook handler and its tests need.
  const key =
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.length > 0
      ? process.env.STRIPE_SECRET_KEY
      : "sk_test_unset_placeholder";
  cached = new Stripe(key, {
    // Pin the API version for stability — bump deliberately when needed.
    // Must match the version the installed Stripe SDK supports.
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: {
      name: "Renewal Radar",
      version: "0.1.0",
    },
  });
  return cached;
}

export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    const inner = getStripe() as unknown as Record<string | symbol, unknown>;
    const value = inner[prop];
    return typeof value === "function" ? (value as Function).bind(inner) : value;
  },
});
