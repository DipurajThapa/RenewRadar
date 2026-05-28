/**
 * Canonical, single source of truth for pricing tiers.
 *
 * Every place that renders a plan card, a feature matrix, a value-math
 * statement, or a plan-limit gate MUST import from this file. Do not
 * duplicate tier data anywhere — extend the structures here instead.
 *
 * Consumers:
 *   - src/lib/billing/plans.ts            (back-compat PLAN_LIMITS export)
 *   - src/app/pricing/page.tsx            (full pricing page)
 *   - src/components/marketing/marketing-home.tsx (PricingTeaser)
 *   - src/app/(app)/settings/billing/page.tsx     (current-plan card + upgrade grid)
 *   - src/components/settings/plan-card.tsx       (upgrade flow trigger)
 *   - src/app/(app)/subscriptions/actions.ts      (Free Forever cap enforcement)
 */

export type PlanTier =
  | "free_forever"
  | "starter"
  | "growth"
  | "pro"
  | "enterprise";

export type TierDefinition = {
  tier: PlanTier;

  /** Display name e.g. "Free Forever", "Starter" */
  label: string;

  /** Headline e.g. "$0", "$79" */
  priceDisplay: string;

  /** Suffix e.g. "/mo billed annually", "forever" */
  priceCadence: string;

  /** Sub-line e.g. "$948 billed annually" — only shown when there's both an annual and monthly anchor */
  subPriceDisplay?: string;

  /** Annual cost in USD (numeric, for value-math calculations) */
  annualUsd: number;

  /** Monthly cost in USD when billed monthly (numeric) */
  monthlyUsd: number;

  /** ICP one-liner shown above the price on the pricing page */
  tagline: string;

  /** Shorter blurb used in the marketing-home teaser */
  teaserDescription: string;

  /** Feature bullets shown on the pricing-page cards */
  features: string[];

  /** Limits enforced at the data layer */
  limits: {
    maxSubscriptions: number; // Infinity for enterprise
    maxUsers: number; // Infinity for enterprise
    /**
     * Cap on AI-extraction pages per calendar month. Free = 0 (no AI on free).
     * Enforced by `extract-document` Inngest function (Phase C). Soft cap is
     * surfaced in the upgrade nudge well before hitting the hard cap.
     */
    aiExtractionPagesPerMonth: number; // Infinity for enterprise
  };

  /** CTA label on the plan card */
  ctaLabel: string;

  /** Highlight as "Most popular" */
  highlighted?: boolean;

  /** False for free tier (auto-applied) and enterprise (contact sales) */
  publiclyPurchasable: boolean;

  /** Break-even value math for the pricing page (skipped for free + enterprise) */
  breakEven?: {
    totalCostDisplay: string; // "$948/year"
    event: string; // "One avoided $1K auto-renewal"
    note: string; // "Or 2 reclaimed seats..."
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Canonical tier definitions
// ─────────────────────────────────────────────────────────────────────────

export const TIER_DEFINITIONS: Record<PlanTier, TierDefinition> = {
  free_forever: {
    tier: "free_forever",
    label: "Free Forever",
    priceDisplay: "$0",
    priceCadence: "forever",
    annualUsd: 0,
    monthlyUsd: 0,
    tagline: "For solo IT/Ops on a starter stack",
    teaserDescription:
      "Track up to 5 subscriptions. Single user. Email alerts.",
    features: [
      "Up to 5 subscriptions",
      "1 internal user",
      "Notice deadline alerts (email)",
      "Renewal calendar",
      "Cancellation letter drafts",
      "Community support",
    ],
    limits: {
      maxSubscriptions: 5,
      maxUsers: 1,
      aiExtractionPagesPerMonth: 0,
    },
    ctaLabel: "Start free",
    publiclyPurchasable: false,
  },

  starter: {
    tier: "starter",
    label: "Starter",
    priceDisplay: "$79",
    priceCadence: "/mo",
    subPriceDisplay: "$948 billed annually",
    annualUsd: 948,
    monthlyUsd: 79,
    tagline: "<50 employees, <$200K SaaS spend",
    teaserDescription:
      "Up to 50 subscriptions, 3 users, AI contract extraction, action queue.",
    features: [
      "Up to 50 subscriptions",
      "3 internal users",
      "AI contract extraction · up to 200 pages/mo",
      "Notice-deadline action queue",
      "CSV import & export",
      "Email + in-app alerts",
      "Audit log (12 months)",
      "Email support · 2 business days",
    ],
    limits: {
      maxSubscriptions: 50,
      maxUsers: 3,
      aiExtractionPagesPerMonth: 200,
    },
    ctaLabel: "Start 14-day trial",
    highlighted: true,
    publiclyPurchasable: true,
    breakEven: {
      totalCostDisplay: "$948/year",
      event: "One AI-extracted notice deadline that catches a $1K auto-renewal",
      note: "Pays for itself the first time a renewal you would have missed is caught",
    },
  },

  growth: {
    tier: "growth",
    label: "Growth",
    priceDisplay: "$299",
    priceCadence: "/mo",
    subPriceDisplay: "$3,588 billed annually",
    annualUsd: 3588,
    monthlyUsd: 299,
    tagline: "50–200 employees, $200K–$1M SaaS spend",
    teaserDescription:
      "Up to 200 subscriptions, 10 users, prep pack + savings tracker.",
    features: [
      "Up to 200 subscriptions",
      "10 internal users",
      "Everything in Starter",
      "AI contract extraction · up to 1,000 pages/mo",
      "Renewal Prep Pack (PDF)",
      "Savings tracker + outcome reports",
      "Slack alerts",
      "Approvals-lite",
      "Email support · 1 business day",
    ],
    limits: {
      maxSubscriptions: 200,
      maxUsers: 10,
      aiExtractionPagesPerMonth: 1_000,
    },
    ctaLabel: "Start 14-day trial",
    publiclyPurchasable: true,
    breakEven: {
      totalCostDisplay: "$3,588/year",
      event: "One AI-extracted price-increase clause caught before renewal",
      note: "Or a single $4K vendor downgrade tracked in the savings ledger",
    },
  },

  pro: {
    tier: "pro",
    label: "Pro",
    priceDisplay: "$899",
    priceCadence: "/mo",
    subPriceDisplay: "$10,788 billed annually",
    annualUsd: 10788,
    monthlyUsd: 899,
    tagline: "200–500 employees, $1M–$3M SaaS spend",
    teaserDescription:
      "Up to 500 subscriptions, 25 users, custom DPA, dedicated onboarding.",
    features: [
      "Up to 500 subscriptions",
      "25 internal users",
      "Everything in Growth",
      "AI contract extraction · up to 5,000 pages/mo",
      "Custom DPA / security review",
      "Audit log export (36 months)",
      "1-hour onboarding kickoff",
      "Email support · 4 business hours",
    ],
    limits: {
      maxSubscriptions: 500,
      maxUsers: 25,
      aiExtractionPagesPerMonth: 5_000,
    },
    ctaLabel: "Start 14-day trial",
    publiclyPurchasable: true,
    breakEven: {
      totalCostDisplay: "$10,788/year",
      event: "One AI-extracted auto-renewal flag on a $12K contract",
      note: "Typical Pro account books $40K+ in tracked savings per year",
    },
  },

  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    priceDisplay: "From $18K",
    priceCadence: "/year",
    annualUsd: 18000,
    monthlyUsd: 1500,
    tagline: "500+ employees, custom requirements",
    teaserDescription: "Unlimited subscriptions and users. Custom terms.",
    features: [
      "Unlimited subscriptions",
      "Unlimited internal users",
      "Unlimited AI contract extraction",
      "SAML SSO",
      "Dedicated Customer Success Manager",
      "4-hour guided onboarding",
      "Audit log (7 years)",
      "Contracted SLA",
    ],
    limits: {
      maxSubscriptions: Number.POSITIVE_INFINITY,
      maxUsers: Number.POSITIVE_INFINITY,
      aiExtractionPagesPerMonth: Number.POSITIVE_INFINITY,
    },
    ctaLabel: "Talk to sales",
    publiclyPurchasable: false,
  },
};

/** Display order across all pricing surfaces */
export const ALL_TIERS_IN_ORDER: PlanTier[] = [
  "free_forever",
  "starter",
  "growth",
  "pro",
  "enterprise",
];

/** Tiers shown on the public pricing page (excludes enterprise — separate CTA) */
export const PUBLIC_TIERS_IN_ORDER: PlanTier[] = [
  "free_forever",
  "starter",
  "growth",
  "pro",
];

/** Tiers shown on the marketing-home teaser (3 cards only — short and punchy) */
export const TEASER_TIERS_IN_ORDER: PlanTier[] = [
  "free_forever",
  "starter",
  "growth",
];

/** Tiers offered in the in-product upgrade flow (excludes free + enterprise) */
export type UpgradeTier = Exclude<PlanTier, "free_forever" | "enterprise">;
export const UPGRADE_TIERS_IN_ORDER: UpgradeTier[] = [
  "starter",
  "growth",
  "pro",
];

// ─────────────────────────────────────────────────────────────────────────
// Feature matrix (also canonical — no duplication)
// ─────────────────────────────────────────────────────────────────────────

export type FeatureCell = boolean | string;

export type FeatureRow = {
  label: string;
  /** Cell value per tier: `true` = ✓, `false` = —, string = literal text */
  cells: Record<PlanTier, FeatureCell>;
};

export const FEATURE_MATRIX: FeatureRow[] = [
  {
    label: "Subscriptions tracked",
    cells: {
      free_forever: "5",
      starter: "50",
      growth: "200",
      pro: "500",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Internal users",
    cells: {
      free_forever: "1",
      starter: "3",
      growth: "10",
      pro: "25",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Notice deadline alerts",
    cells: {
      free_forever: true,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Renewal calendar",
    cells: {
      free_forever: true,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Cancellation letter drafts",
    cells: {
      free_forever: true,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Email alerts",
    cells: {
      free_forever: true,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "In-app notifications",
    cells: {
      free_forever: false,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Renewal Prep Pack",
    cells: {
      free_forever: false,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Monthly summary PDF",
    cells: {
      free_forever: false,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "AI contract extraction (pages/mo)",
    cells: {
      free_forever: "—",
      starter: "200",
      growth: "1,000",
      pro: "5,000",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Action queue + risk scoring",
    cells: {
      free_forever: false,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "CSV import / export",
    cells: {
      free_forever: false,
      starter: true,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Savings tracker + outcome reports",
    cells: {
      free_forever: false,
      starter: false,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Slack alerts",
    cells: {
      free_forever: false,
      starter: false,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Approvals-lite",
    cells: {
      free_forever: false,
      starter: false,
      growth: true,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "Custom DPA",
    cells: {
      free_forever: false,
      starter: false,
      growth: false,
      pro: true,
      enterprise: true,
    },
  },
  {
    label: "SAML SSO",
    cells: {
      free_forever: false,
      starter: false,
      growth: false,
      pro: false,
      enterprise: true,
    },
  },
  {
    label: "Audit log retention",
    cells: {
      free_forever: "30 days",
      starter: "12 mo",
      growth: "24 mo",
      pro: "36 mo",
      enterprise: "7 years",
    },
  },
  {
    label: "Support SLA",
    cells: {
      free_forever: "Community",
      starter: "2 bd",
      growth: "1 bd",
      pro: "4 bh",
      enterprise: "1 bh",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Helpers (derived data — never duplicate this logic in consumers)
// ─────────────────────────────────────────────────────────────────────────

/** Quick display label for in-product Badge: "$79/mo", "Free Forever", etc. */
export function tierBadgeLabel(tier: PlanTier): string {
  const def = TIER_DEFINITIONS[tier];
  if (tier === "free_forever") return "Free Forever";
  if (tier === "enterprise") return "Enterprise";
  return `${def.priceDisplay}${def.priceCadence}`;
}

/** Human-readable max-subscriptions string for "X of Y" labels */
export function maxSubscriptionsDisplay(tier: PlanTier): string {
  const limit = TIER_DEFINITIONS[tier].limits.maxSubscriptions;
  return Number.isFinite(limit) ? String(limit) : "unlimited";
}

/** Human-readable max-users string */
export function maxUsersDisplay(tier: PlanTier): string {
  const limit = TIER_DEFINITIONS[tier].limits.maxUsers;
  return Number.isFinite(limit) ? String(limit) : "unlimited";
}
