import { getCurrentAccountAndUser } from "@/lib/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PortalButton } from "@/components/settings/portal-button";
import { PlanCard } from "@/components/settings/plan-card";
import {
  TIER_DEFINITIONS,
  UPGRADE_TIERS_IN_ORDER,
  maxSubscriptionsDisplay,
  maxUsersDisplay,
  tierBadgeLabel,
} from "@/lib/billing/tier-definitions";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { upgrade?: string };
}) {
  const { account } = await getCurrentAccountAndUser();
  const tier = TIER_DEFINITIONS[account.planTier];

  return (
    <div className="space-y-6">
      {searchParams.upgrade === "success" && <UpgradeSuccessBanner />}
      {searchParams.upgrade === "cancelled" && <UpgradeCancelledBanner />}

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold">{tier.label}</span>
                <Badge variant="outline">{tierBadgeLabel(tier.tier)}</Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Up to {maxSubscriptionsDisplay(tier.tier)} subscriptions ·{" "}
                {maxUsersDisplay(tier.tier)} user
                {tier.limits.maxUsers === 1 ? "" : "s"}
              </div>
            </div>

            {account.stripeCustomerId && <PortalButton />}
          </div>

          {account.trialExpiresAt &&
            account.trialExpiresAt.getTime() > Date.now() && (
              <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                Your trial ends on{" "}
                <strong>{formatDate(account.trialExpiresAt)}</strong>. After
                that, you'll be billed at the plan rate unless you cancel.
              </div>
            )}
        </CardContent>
      </Card>

      {account.planTier !== "enterprise" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {account.planTier === "free_forever" ? "Upgrade" : "Switch plan"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {account.planTier === "free_forever"
                ? "Unlock more subscriptions, AI contract extraction, the action queue, CSV import, and savings tracking."
                : "Move up or down a tier. To downgrade, use Manage in Stripe above."}
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {UPGRADE_TIERS_IN_ORDER.map((t) => (
              <PlanCard
                key={t}
                tier={t}
                current={account.planTier === t}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {(account.planTier === "pro" || account.planTier === "enterprise") && (
        <Card>
          <CardHeader>
            <CardTitle>Legal</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              Your plan includes a Data Processing Addendum.
            </p>
            <a
              href="/legal/dpa"
              className="text-sm underline underline-offset-4"
            >
              View current DPA →
            </a>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What you don't pay for</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Cancellation is one click in the Stripe portal. Failed payments
            trigger Stripe's standard dunning (no extra fees). Data export is
            free at any time from the data privacy settings.
          </p>
          <p>
            We don't sell your contract data. Your privacy is part of what
            you're paying for.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function UpgradeSuccessBanner() {
  return (
    <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
      🎉 Upgrade complete. Welcome to your new plan. If you don't see the new
      limits yet, give it a few seconds for the Stripe webhook to land and
      refresh the page.
    </div>
  );
}

function UpgradeCancelledBanner() {
  return (
    <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
      No charge made. You can pick up the upgrade anytime.
    </div>
  );
}
