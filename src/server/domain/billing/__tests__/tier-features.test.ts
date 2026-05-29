/**
 * Contract tests for the tier-features enforcement layer.
 *
 * Two kinds of tests live here:
 *
 *   1. Behavioural — `requireTierFeature` throws / `hasTierFeature` returns
 *      booleans the way the rest of the app expects.
 *   2. Consistency — the boolean `TIER_FEATURE_AVAILABILITY` map agrees with
 *      the marketing-display `FEATURE_MATRIX` row of the same name. If a PM
 *      flips one and forgets the other, this test fails CI.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_TIERS_IN_ORDER,
  FEATURE_MATRIX,
  type PlanTier,
} from "@server/domain/billing/tier-definitions";
import {
  hasTierFeature,
  lowestTierWith,
  requireTierFeature,
  TIER_FEATURE_AVAILABILITY,
  TIER_FEATURE_LABEL,
  TierFeatureDeniedError,
  type TierFeature,
} from "@server/domain/billing/tier-features";

const ALL_FEATURES = Object.keys(TIER_FEATURE_AVAILABILITY) as TierFeature[];

describe("requireTierFeature", () => {
  it("throws TierFeatureDeniedError when the tier lacks the feature", () => {
    expect(() =>
      requireTierFeature("free_forever", "renewalPrepPack")
    ).toThrowError(TierFeatureDeniedError);
  });

  it("does not throw when the tier includes the feature", () => {
    expect(() =>
      requireTierFeature("starter", "renewalPrepPack")
    ).not.toThrow();
    expect(() =>
      requireTierFeature("enterprise", "samlSso")
    ).not.toThrow();
  });

  it("error carries feature, currentTier, and upgradeToTier", () => {
    try {
      requireTierFeature("starter", "savingsReports");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TierFeatureDeniedError);
      const e = err as TierFeatureDeniedError;
      expect(e.feature).toBe("savingsReports");
      expect(e.currentTier).toBe("starter");
      expect(e.upgradeToTier).toBe("growth");
      // Message is human-readable so it can go straight to the UI.
      expect(e.message).toMatch(/Growth/i);
      expect(e.message).toMatch(/Starter/i);
    }
  });

  it("samlSso upgrade target is enterprise (the only tier with it)", () => {
    try {
      requireTierFeature("pro", "samlSso");
      expect.fail("expected throw");
    } catch (err) {
      const e = err as TierFeatureDeniedError;
      expect(e.upgradeToTier).toBe("enterprise");
    }
  });
});

describe("hasTierFeature", () => {
  it("matches requireTierFeature for every (tier, feature) pair", () => {
    for (const tier of ALL_TIERS_IN_ORDER) {
      for (const feature of ALL_FEATURES) {
        const expected = TIER_FEATURE_AVAILABILITY[feature][tier];
        expect(hasTierFeature(tier, feature)).toBe(expected);
        // And `requireTierFeature` matches: throws iff hasTierFeature is false.
        if (expected) {
          expect(() => requireTierFeature(tier, feature)).not.toThrow();
        } else {
          expect(() => requireTierFeature(tier, feature)).toThrow(
            TierFeatureDeniedError
          );
        }
      }
    }
  });
});

describe("lowestTierWith", () => {
  it("returns starter for features available from starter up", () => {
    expect(lowestTierWith("renewalPrepPack")).toBe("starter");
    expect(lowestTierWith("csvImportExport")).toBe("starter");
  });

  it("returns growth for growth-and-up features", () => {
    expect(lowestTierWith("savingsReports")).toBe("growth");
    expect(lowestTierWith("approvalsLite")).toBe("growth");
  });

  it("returns pro for pro-only feature", () => {
    expect(lowestTierWith("customDpa")).toBe("pro");
  });

  it("returns enterprise for enterprise-only feature", () => {
    expect(lowestTierWith("samlSso")).toBe("enterprise");
  });
});

describe("TIER_FEATURE_AVAILABILITY contract", () => {
  it("has an entry for every TierFeature key", () => {
    // Compile-time + runtime check: TIER_FEATURE_LABEL and AVAILABILITY have
    // the same keys.
    const labelKeys = new Set(Object.keys(TIER_FEATURE_LABEL));
    const availabilityKeys = new Set(Object.keys(TIER_FEATURE_AVAILABILITY));
    expect(availabilityKeys).toEqual(labelKeys);
  });

  it("every feature is available on at least one tier", () => {
    for (const feature of ALL_FEATURES) {
      const anyTrue = ALL_TIERS_IN_ORDER.some(
        (tier) => TIER_FEATURE_AVAILABILITY[feature][tier]
      );
      expect(anyTrue, `${feature} is unreachable on every tier`).toBe(true);
    }
  });

  it("enterprise includes every feature (Enterprise is the most-features tier)", () => {
    for (const feature of ALL_FEATURES) {
      expect(
        TIER_FEATURE_AVAILABILITY[feature].enterprise,
        `enterprise should include ${feature}`
      ).toBe(true);
    }
  });

  it("free_forever excludes every paid feature", () => {
    // No paid feature in this catalogue should be in free_forever.
    // (free_forever-only or universal features would live elsewhere or as
    // separate flags — keep this catalogue strict.)
    for (const feature of ALL_FEATURES) {
      expect(
        TIER_FEATURE_AVAILABILITY[feature].free_forever,
        `${feature} should not be on free_forever`
      ).toBe(false);
    }
  });

  it("availability is monotonic across tier order (no holes)", () => {
    // If a feature is available on tier N, it must be available on every
    // tier above N. Holes mean misconfiguration.
    for (const feature of ALL_FEATURES) {
      let sawTrue = false;
      for (const tier of ALL_TIERS_IN_ORDER) {
        const available = TIER_FEATURE_AVAILABILITY[feature][tier];
        if (available) sawTrue = true;
        if (sawTrue && !available) {
          throw new Error(
            `${feature} is non-monotonic: available on a lower tier but not on ${tier}`
          );
        }
      }
    }
  });
});

describe("consistency with FEATURE_MATRIX (marketing surface)", () => {
  // Map of feature-id → FEATURE_MATRIX row label. When the row's cells are
  // boolean, they must match TIER_FEATURE_AVAILABILITY exactly. When the row
  // is string-display only (e.g. "200 pages/mo"), no enforcement gate exists
  // and we skip the check.
  const FEATURE_TO_MATRIX_LABEL: Record<TierFeature, string> = {
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

  for (const [feature, label] of Object.entries(FEATURE_TO_MATRIX_LABEL) as [
    TierFeature,
    string,
  ][]) {
    it(`${feature} matches FEATURE_MATRIX row "${label}"`, () => {
      const row = FEATURE_MATRIX.find((r) => r.label === label);
      expect(row, `FEATURE_MATRIX missing row "${label}"`).toBeDefined();
      if (!row) return;
      for (const tier of ALL_TIERS_IN_ORDER as PlanTier[]) {
        const cell = row.cells[tier];
        // Only enforce when the marketing cell is a strict boolean; string
        // cells are display variants and aren't a gate signal.
        if (typeof cell !== "boolean") continue;
        expect(
          TIER_FEATURE_AVAILABILITY[feature][tier],
          `Drift on ${feature}/${tier}: matrix says ${cell}`
        ).toBe(cell);
      }
    });
  }
});
