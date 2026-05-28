import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card, CardContent } from "@ui/components/primitives/card";
import { MarketingNav } from "@ui/features/marketing/marketing-nav";
import { MarketingFooter } from "@ui/features/marketing/marketing-footer";
import { FAQItem } from "@ui/components/shared/faq-item";
import {
  TIER_DEFINITIONS,
  PUBLIC_TIERS_IN_ORDER,
  FEATURE_MATRIX,
  type PlanTier,
  type TierDefinition,
} from "@server/domain/billing/tier-definitions";

export const metadata = {
  title: "Pricing — Renewal Radar",
  description:
    "Simple, public pricing. Free Forever, Starter $79/mo, Growth $299/mo, Pro $899/mo. Annual billing preferred.",
};

export default function PricingPage() {
  return (
    <div className="bg-white">
      <MarketingNav />

      <PricingHero />
      <PricingGrid />
      <FeatureMatrix />
      <ValueMath />
      <PricingFAQ />
      <EnterpriseCTA />

      <MarketingFooter />
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────

function PricingHero() {
  return (
    <section className="px-6 pt-16 md:pt-20 pb-8 text-center">
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
        Simple, public pricing
      </h1>
      <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
        Free Forever has no time limit. Paid tiers calibrated so one prevented
        miss covers the whole year.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Annual billing shown. Monthly available at +20%. All paid tiers include
        a 14-day trial. No card required to start.
      </p>
    </section>
  );
}

// ─── Tier Grid (data derives from TIER_DEFINITIONS) ──────────────────────

function PricingGrid() {
  return (
    <section className="px-6 pb-16">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PUBLIC_TIERS_IN_ORDER.map((tier) => (
          <PlanCard key={tier} definition={TIER_DEFINITIONS[tier]} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ definition }: { definition: TierDefinition }) {
  return (
    <Card
      className={
        definition.highlighted
          ? "border-foreground border-2 shadow-xl relative"
          : "h-full"
      }
    >
      {definition.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background px-3 py-0.5 rounded-full text-xs font-medium">
          Most popular
        </div>
      )}
      <CardContent className="pt-6 space-y-4 h-full flex flex-col">
        <div>
          <div className="font-semibold text-lg">{definition.label}</div>
          <div className="text-xs text-muted-foreground mt-1 min-h-[2.5em]">
            {definition.tagline}
          </div>
        </div>

        <div>
          <div className="flex items-baseline">
            <span className="text-3xl font-bold tabular-nums">
              {definition.priceDisplay}
            </span>
            <span className="text-sm text-muted-foreground ml-1">
              {definition.priceCadence}
            </span>
          </div>
          {definition.subPriceDisplay && (
            <div className="text-xs text-muted-foreground mt-1">
              {definition.subPriceDisplay}
            </div>
          )}
        </div>

        <ul className="space-y-2 flex-1">
          {definition.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <Button
          asChild
          variant={definition.highlighted ? "default" : "outline"}
          className="w-full"
        >
          <Link href="/sign-up">{definition.ctaLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Feature Matrix (data derives from FEATURE_MATRIX constant) ──────────

function FeatureMatrix() {
  const tiers = PUBLIC_TIERS_IN_ORDER;

  return (
    <section className="px-6 py-16 bg-muted/20">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-8">
          Compare features
        </h2>

        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Feature</th>
                {tiers.map((t) => (
                  <th key={t} className="text-center px-4 py-3 font-medium">
                    {TIER_DEFINITIONS[t].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((row, ri) => (
                <tr key={ri} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  {tiers.map((tier) => (
                    <td key={tier} className="px-4 py-3 text-center">
                      <FeatureCellRender value={row.cells[tier]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FeatureCellRender({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-green-600 inline-block" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground/50 inline-block" />
    );
  }
  return <span className="text-foreground/80">{value}</span>;
}

// ─── Value Math (data derives from .breakEven on each TierDefinition) ────

function ValueMath() {
  const tiers: PlanTier[] = ["starter", "growth", "pro"];
  return (
    <section className="px-6 py-20">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-3xl font-bold tracking-tight">
            Each tier pays for itself on one event
          </h2>
          <p className="mt-3 text-muted-foreground">
            No theoretical savings. Just events we surface that you can verify
            in your own records.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {tiers.map((tier) => {
            const def = TIER_DEFINITIONS[tier];
            if (!def.breakEven) return null;
            return (
              <Card key={tier}>
                <CardContent className="pt-6 space-y-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {def.label}
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {def.breakEven.totalCostDisplay}
                  </div>
                  <div className="border-t pt-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                      Breaks even on
                    </div>
                    <p className="font-medium">{def.breakEven.event}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {def.breakEven.note}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing FAQ (uses shared FAQItem) ───────────────────────────────────

function PricingFAQ() {
  return (
    <section className="px-6 py-20 bg-muted/20">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-10">
          Pricing questions
        </h2>

        <dl className="space-y-6">
          <FAQItem
            q="Do you offer a free trial?"
            a="Free Forever is unlimited in time but capped at 5 subscriptions. Paid tiers (Starter / Growth / Pro) include a 14-day trial — full features, no credit card required to start."
          />
          <FAQItem
            q="Can I switch tiers later?"
            a="Yes, any time. Upgrades are immediate and prorated. Downgrades take effect at the end of your current billing period. All done in the Stripe customer portal — one click."
          />
          <FAQItem
            q="What if I cancel mid-term?"
            a="Cancel any time. Prorated refund within 60 days of your most recent payment. After 60 days, your access continues through the end of the paid period and ends naturally — no refund."
          />
          <FAQItem
            q="What happens if my payment fails?"
            a="Stripe runs standard dunning (3 retries over ~21 days) and sends you reminders. Your account stays in 'past due' grace during this window. After 21 days of failed attempts, you revert to Free Forever and the data is preserved."
          />
          <FAQItem
            q="Do you charge per user or per subscription tracked?"
            a="Per account, with both user and subscription caps per tier. Most teams hit the subscription cap before the user cap — it's the more binding limit."
          />
          <FAQItem
            q="Are taxes included?"
            a="No — Stripe collects sales tax where required by your jurisdiction. Tax is shown on the checkout page before you confirm."
          />
        </dl>
      </div>
    </section>
  );
}

// ─── Enterprise CTA (data derives from TIER_DEFINITIONS.enterprise) ──────

function EnterpriseCTA() {
  const enterprise = TIER_DEFINITIONS.enterprise;
  return (
    <section className="px-6 py-20">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2">
          <CardContent className="pt-8 pb-8 px-6 md:px-12 grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {enterprise.label}
              </div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                More than 500 subscriptions or need custom terms?
              </h2>
              <p className="mt-3 text-muted-foreground">
                Enterprise plans start at $
                {enterprise.annualUsd.toLocaleString("en-US")}/year and include
                SAML SSO, a dedicated CSM, a 4-hour guided onboarding, a 7-year
                audit log archive, and contracted SLA.
              </p>
            </div>
            <div className="space-y-3">
              <Button asChild size="lg" className="w-full">
                <a href="mailto:hello@renewalradar.com?subject=Enterprise%20inquiry">
                  Email us
                </a>
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                We reply within one business day.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
