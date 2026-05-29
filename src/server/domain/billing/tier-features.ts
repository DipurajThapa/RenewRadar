/**
 * Feature-tier enforcement — the runtime counterpart to FEATURE_MATRIX.
 *
 * FEATURE_MATRIX in tier-definitions.ts is the *marketing* surface (display
 * strings for the pricing page). It cannot be used at a request boundary
 * because its cells are `string | boolean` for display purposes. This file is
 * the *enforcement* surface: a strict boolean map keyed by feature ID, with a
 * `requireTierFeature` throw-on-deny helper.
 *
 * INVARIANT: Every feature row in FEATURE_MATRIX that is purely boolean per
 * tier MUST have a matching `TIER_FEATURE_AVAILABILITY` entry. The consistency
 * test in `__tests__/tier-features.test.ts` fails CI when the two drift.
 *
 * Usage at server boundaries:
 *
 *     const { account, user } = await getCurrentAccountAndUser();
 *     requireTierFeature(account.planTier, "renewalPrepPack");
 *     // ...proceed with the protected action
 *
 * UI conditionals should use `hasTierFeature` — never let the UI render a
 * button that the server gate doesn't honor.
 */
import {
  ALL_TIERS_IN_ORDER,
  TIER_DEFINITIONS,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";

// ─────────────────────────────────────────────────────────────────────────
// Feature catalogue
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stable feature IDs. NEVER rename without a migration of every callsite.
 * Adding a feature: define here, add to TIER_FEATURE_AVAILABILITY, add to
 * FEATURE_MATRIX row if user-visible, add a test.
 */
export type TierFeature =
  | "inAppNotifications"
  | "renewalPrepPack"
  | "monthlySummaryPdf"
  | "actionQueue"
  | "csvImportExport"
  | "savingsReports"
  | "renewalBrief"
  | "spendAutoDiscovery"
  | "slackAlerts"
  | "approvalsLite"
  | "customDpa"
  | "samlSso";

/**
 * Display labels for upgrade nudges. Plain strings — not Markdown — so they
 * can be embedded in JSON responses, toast messages, or PDF footers.
 */
export const TIER_FEATURE_LABEL: Record<TierFeature, string> = {
  inAppNotifications: "In-app notifications",
  renewalPrepPack: "Renewal Prep Pack",
  monthlySummaryPdf: "Monthly summary PDF",
  actionQueue: "Action queue + risk scoring",
  csvImportExport: "CSV import / export",
  savingsReports: "Savings tracker + outcome reports",
  renewalBrief: "Renewal intelligence brief",
  spendAutoDiscovery: "Spend auto-discovery feed",
  slackAlerts: "Slack alerts",
  approvalsLite: "Approvals-lite",
  customDpa: "Custom DPA",
  samlSso: "SAML SSO",
};

/**
 * Authoritative availability map. The runtime gate reads this. Keep aligned
 * with FEATURE_MATRIX (the consistency test enforces).
 */
export const TIER_FEATURE_AVAILABILITY: Record<
  TierFeature,
  Record<PlanTier, boolean>
> = {
  inAppNotifications: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  renewalPrepPack: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  monthlySummaryPdf: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  actionQueue: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  csvImportExport: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  savingsReports: {
    free_forever: false,
    starter: false,
    growth: true,
    pro: true,
    enterprise: true,
  },
  // Wedge features — the auto-ingestion feed and the AI-reasoned brief are the
  // core paid value. Available from Starter up (mirrors renewalPrepPack /
  // csvImportExport), so Free Forever sees an upgrade nudge, not the action.
  renewalBrief: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  spendAutoDiscovery: {
    free_forever: false,
    starter: true,
    growth: true,
    pro: true,
    enterprise: true,
  },
  slackAlerts: {
    free_forever: false,
    starter: false,
    growth: true,
    pro: true,
    enterprise: true,
  },
  approvalsLite: {
    free_forever: false,
    starter: false,
    growth: true,
    pro: true,
    enterprise: true,
  },
  customDpa: {
    free_forever: false,
    starter: false,
    growth: false,
    pro: true,
    enterprise: true,
  },
  samlSso: {
    free_forever: false,
    starter: false,
    growth: false,
    pro: false,
    enterprise: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Error
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thrown by `requireTierFeature` when an account's plan tier doesn't include
 * the requested feature. Carries the upgrade-target tier so the caller can
 * render an upgrade nudge without re-deriving it.
 */
export class TierFeatureDeniedError extends Error {
  readonly feature: TierFeature;
  readonly currentTier: PlanTier;
  /** The lowest tier (excluding enterprise) that grants this feature. */
  readonly upgradeToTier: PlanTier | null;

  constructor(args: {
    feature: TierFeature;
    currentTier: PlanTier;
    upgradeToTier: PlanTier | null;
  }) {
    const upgradeLabel = args.upgradeToTier
      ? TIER_DEFINITIONS[args.upgradeToTier].label
      : "Enterprise";
    super(
      `${TIER_FEATURE_LABEL[args.feature]} requires ${upgradeLabel}. ` +
        `Your plan: ${TIER_DEFINITIONS[args.currentTier].label}.`
    );
    this.name = "TierFeatureDeniedError";
    this.feature = args.feature;
    this.currentTier = args.currentTier;
    this.upgradeToTier = args.upgradeToTier;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Throws `TierFeatureDeniedError` if `tier` doesn't include `feature`.
 * Call at the top of every server boundary that gates a paid feature:
 * API route handlers, server actions, Inngest job handlers iterating over
 * accounts.
 *
 * Returns void on success so it composes naturally with `requireRole`.
 */
export function requireTierFeature(
  tier: PlanTier,
  feature: TierFeature
): void {
  if (TIER_FEATURE_AVAILABILITY[feature][tier]) return;
  throw new TierFeatureDeniedError({
    feature,
    currentTier: tier,
    upgradeToTier: lowestTierWith(feature),
  });
}

/** Boolean variant for UI conditionals — "should we render the button?". */
export function hasTierFeature(
  tier: PlanTier,
  feature: TierFeature
): boolean {
  return TIER_FEATURE_AVAILABILITY[feature][tier];
}

/**
 * Returns the lowest tier (in display order) that grants the feature, or
 * null if no tier grants it (shouldn't happen — every feature should be
 * obtainable). Used to build upgrade nudges.
 */
export function lowestTierWith(feature: TierFeature): PlanTier | null {
  for (const tier of ALL_TIERS_IN_ORDER) {
    if (TIER_FEATURE_AVAILABILITY[feature][tier]) return tier;
  }
  return null;
}
