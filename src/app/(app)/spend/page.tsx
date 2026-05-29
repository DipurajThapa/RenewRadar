import Link from "next/link";
import { Lock, Megaphone, Plug } from "lucide-react";
import { getCurrentAccountAndUser } from "@server/middleware/current-user";
import {
  listDetectedRecurringCharges,
  listSpendConnections,
} from "@server/infrastructure/db/repositories/spend";
import {
  hasTierFeature,
  lowestTierWith,
} from "@server/domain/billing/tier-features";
import { TIER_DEFINITIONS } from "@server/domain/billing/tier-definitions";
import { PageHeader } from "@ui/components/shared/page-header";
import { ConnectFeedButton } from "@ui/features/spend/connect-feed-button";
import { RecurringChargeRow } from "@ui/features/spend/recurring-charge-row";

export const dynamic = "force-dynamic";

export default async function SpendPage() {
  const { account } = await getCurrentAccountAndUser();
  // Tier gate: the spend feed is a paid feature. The server actions enforce
  // this too — the UI must never offer a button the server will reject.
  const canUse = hasTierFeature(account.planTier, "spendAutoDiscovery");
  if (!canUse) {
    const upgradeTier = lowestTierWith("spendAutoDiscovery");
    const upgradeLabel = upgradeTier
      ? TIER_DEFINITIONS[upgradeTier].label
      : "a paid plan";
    return (
      <div className="space-y-8 max-w-3xl">
        <PageHeader>
          <PageHeader.Row>
            <div className="space-y-2">
              <PageHeader.Title>Spend feed</PageHeader.Title>
              <PageHeader.Description>
                Connect your card/expense feed and your subscription inventory
                builds itself — recurring charges are detected automatically.
                You stop being the data pipe.
              </PageHeader.Description>
            </div>
          </PageHeader.Row>
        </PageHeader>
        <div className="rounded-md border border-dashed bg-background p-10 text-center">
          <Lock className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">
            Spend auto-discovery is a {upgradeLabel} feature.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Upgrade to auto-detect subscriptions from card activity instead of
            entering them by hand.
          </p>
          <Link
            href="/settings/billing"
            className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-strong transition-colors"
          >
            Upgrade to {upgradeLabel}
          </Link>
        </div>
      </div>
    );
  }

  const [connections, detected] = await Promise.all([
    listSpendConnections(account.id),
    listDetectedRecurringCharges(account.id),
  ]);
  const active = connections.find((c) => c.status === "active");

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader>
        <PageHeader.Row>
          <div className="space-y-2">
            <PageHeader.Title>Spend feed</PageHeader.Title>
            <PageHeader.Description>
              Connect your card/expense feed and your subscription inventory
              builds itself — recurring charges are detected automatically and
              wait here for one click. You stop being the data pipe.
            </PageHeader.Description>
          </div>
          <ConnectFeedButton connected={Boolean(active)} />
        </PageHeader.Row>
      </PageHeader>

      {!active ? (
        <div className="rounded-md border border-dashed bg-background p-10 text-center">
          <Plug className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No spend feed connected yet. Connect one to auto-discover your SaaS
            subscriptions from card activity — no manual entry.
          </p>
        </div>
      ) : detected.length === 0 ? (
        <div className="rounded-md border border-dashed bg-background p-10 text-center">
          <Megaphone className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Feed connected. No new recurring charges to review — everything
            detected has been actioned. New charges appear here automatically.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Detected subscriptions to review ({detected.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            These recurring charges were auto-detected from your spend. Confirm
            the real ones into your inventory; dismiss anything that isn&apos;t a
            subscription. We never add anything without your confirmation.
          </p>
          <div className="space-y-2">
            {detected.map((c) => (
              <RecurringChargeRow
                key={c.id}
                id={c.id}
                vendorName={c.suggestedVendorName}
                cycle={c.detectedCycle}
                typicalAmountCents={c.typicalAmountCents}
                currency={c.currency}
                confidence={c.confidence}
                sampleSize={c.sampleSize}
                amountDriftPct={c.amountDriftPct}
                needsManualConfirm={c.needsManualConfirm}
                projectedNextChargeOn={c.projectedNextChargeOn}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
