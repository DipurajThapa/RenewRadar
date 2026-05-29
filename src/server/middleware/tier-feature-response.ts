/**
 * HTTP response helper for `TierFeatureDeniedError`.
 *
 * Use in API routes so feature-gate denials return a consistent 403 + JSON
 * body the UI can render an upgrade nudge from. The body intentionally
 * mirrors the error's public fields so the client doesn't need to parse a
 * message string.
 *
 *     try {
 *       requireTierFeature(account.planTier, "renewalPrepPack");
 *     } catch (err) {
 *       if (err instanceof TierFeatureDeniedError) {
 *         return tierFeatureDeniedResponse(err);
 *       }
 *       throw err;
 *     }
 */
import { NextResponse } from "next/server";
import { TierFeatureDeniedError } from "@server/domain/billing/tier-features";

export function tierFeatureDeniedResponse(
  err: TierFeatureDeniedError
): NextResponse {
  return NextResponse.json(
    {
      error: "tier_feature_required",
      message: err.message,
      feature: err.feature,
      currentTier: err.currentTier,
      upgradeToTier: err.upgradeToTier,
    },
    { status: 403 }
  );
}
