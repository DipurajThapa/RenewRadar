import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // We don't throw at import time (would break tests, edge runtimes that lazy-load).
  // The first actual API call will fail with a clear message instead.
  console.warn("[stripe] STRIPE_SECRET_KEY not set — billing flows will fail");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  // Pin the API version for stability — bump deliberately when needed.
  // Must match the version the installed Stripe SDK supports.
  apiVersion: "2025-02-24.acacia",
  typescript: true,
  appInfo: {
    name: "Renewal Radar",
    version: "0.1.0",
  },
});
