/**
 * Plan-tier limit lookups, derived from the canonical TIER_DEFINITIONS.
 *
 * Do NOT add new pricing data here — extend src/lib/billing/tier-definitions.ts.
 * This file exists for back-compat with code that historically imported
 * PLAN_LIMITS and the price-id ↔ tier mapping.
 */

import { TIER_DEFINITIONS, type PlanTier } from "./tier-definitions";

export type { PlanTier };

/**
 * Back-compat shape derived from TIER_DEFINITIONS.
 * New code should use TIER_DEFINITIONS[tier] directly.
 */
export const PLAN_LIMITS = Object.fromEntries(
  Object.entries(TIER_DEFINITIONS).map(([tier, def]) => [
    tier,
    {
      maxSubscriptions: def.limits.maxSubscriptions,
      maxUsers: def.limits.maxUsers,
      label: def.label,
      annualPriceUsd: def.annualUsd,
      monthlyPriceUsd: def.monthlyUsd,
    },
  ])
) as Record<
  PlanTier,
  {
    maxSubscriptions: number;
    maxUsers: number;
    label: string;
    annualPriceUsd: number;
    monthlyPriceUsd: number;
  }
>;

// ─────────────────────────────────────────────────────────────────────────
// Stripe price ID ↔ internal tier mapping (separate concern from tier data)
// ─────────────────────────────────────────────────────────────────────────

const PRICE_TO_TIER: Partial<Record<string, PlanTier>> = {
  [process.env.STRIPE_STARTER_PRICE_ID ?? "starter-placeholder"]: "starter",
  [process.env.STRIPE_GROWTH_PRICE_ID ?? "growth-placeholder"]: "growth",
  [process.env.STRIPE_PRO_PRICE_ID ?? "pro-placeholder"]: "pro",
};

export function planTierForPriceId(priceId: string): PlanTier {
  return PRICE_TO_TIER[priceId] ?? "starter";
}

export function priceIdForTier(tier: PlanTier): string | null {
  switch (tier) {
    case "starter":
      return process.env.STRIPE_STARTER_PRICE_ID ?? null;
    case "growth":
      return process.env.STRIPE_GROWTH_PRICE_ID ?? null;
    case "pro":
      return process.env.STRIPE_PRO_PRICE_ID ?? null;
    default:
      return null;
  }
}
