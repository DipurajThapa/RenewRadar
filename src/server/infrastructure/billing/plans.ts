/**
 * Plan-tier limit lookups, derived from the canonical TIER_DEFINITIONS.
 *
 * Do NOT add new pricing data here — extend
 * src/server/domain/billing/tier-definitions.ts. This file lives in the
 * infrastructure layer because it concerns Stripe price-id ↔ tier mapping;
 * the pure tier data lives in the domain layer.
 */

import {
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";

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

/**
 * Build the live price → tier map at call time, NOT at module load.
 *
 * Why call-time: building this at module load captured stale `???-placeholder`
 * strings that masked misconfiguration. If a price ID env var is missing in
 * production, the lookup should fail clean (return null) rather than silently
 * match a placeholder. Webhook callers throw on null, surfacing the
 * misconfiguration immediately rather than letting it leak revenue forever.
 */
function buildPriceToTierMap(): Record<string, PlanTier> {
  const map: Record<string, PlanTier> = {};
  const entries: Array<[string | undefined, PlanTier]> = [
    [process.env.STRIPE_STARTER_PRICE_ID, "starter"],
    [process.env.STRIPE_GROWTH_PRICE_ID, "growth"],
    [process.env.STRIPE_PRO_PRICE_ID, "pro"],
  ];
  for (const [priceId, tier] of entries) {
    if (priceId && priceId.length > 0) map[priceId] = tier;
  }
  return map;
}

/**
 * Look up the internal plan tier for a Stripe price ID.
 *
 * Returns `null` when the price ID is not in any configured env var. Callers
 * MUST handle null explicitly — the previous "default to starter" behaviour
 * silently downgraded a Pro customer ($899/mo) to Starter ($79/mo) every
 * time an env var rotated or typo'd. That was the worst class of revenue
 * leak: silent, asymptomatic, and exactly upside-down.
 */
export function planTierForPriceId(priceId: string): PlanTier | null {
  if (!priceId) return null;
  return buildPriceToTierMap()[priceId] ?? null;
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

/**
 * Returns the list of known Stripe price IDs in the current environment.
 * Useful for the webhook handler to log every configured ID at startup so
 * ops can verify the mapping at deploy time. Exported, not internal, because
 * the boot diagnostic in instrumentation.ts uses it.
 */
export function knownPriceIds(): string[] {
  return Object.keys(buildPriceToTierMap());
}
