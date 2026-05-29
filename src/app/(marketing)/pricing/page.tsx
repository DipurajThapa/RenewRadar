import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { HeroBanner } from "@ui/components/shared/hero-banner";
import { FAQItem } from "@ui/components/shared/faq-item";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
} from "@ui/components/seo/structured-data";
import { PRICING_FAQ } from "@ui/features/marketing/marketing-faqs";
import { LeadCaptureForm } from "@ui/features/marketing/lead-capture-form";
import {
  TIER_DEFINITIONS,
  PUBLIC_TIERS_IN_ORDER,
  FEATURE_MATRIX,
  type PlanTier,
  type TierDefinition,
} from "@server/domain/billing/tier-definitions";

export const metadata: Metadata = {
  // No " — Renewal Radar" suffix here — the root layout's title template
  // (`%s · Renewal Radar`) appends the brand automatically. Repeating the
  // brand triple-stamps it.
  title: "Pricing",
  description:
    "Simple, public pricing. Free Forever, Starter $79/mo, Growth $299/mo, Pro $899/mo. Annual billing preferred — every tier pays for itself on one prevented miss.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — Renewal Radar",
    description:
      "Public pricing across Free, Starter, Growth, Pro, and Enterprise. One prevented missed renewal covers the year.",
    url: "/pricing",
    type: "website",
  },
};

export default function PricingPage() {
  return (
    <>
      <HeroBanner
        eyebrow="Pricing"
        title="Simple, public pricing"
        description="Free Forever has no time limit. Paid tiers are priced so one prevented miss covers the whole year — no theoretical savings."
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/sign-up">
                Start free
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/dashboard">View live demo</Link>
            </Button>
          </>
        }
        metaBelow={
          <span>
            Annual billing shown · Monthly available at +20% · 14-day trial on
            all paid tiers · No card to start
          </span>
        }
      />

      <PricingGrid />
      <FeatureMatrix />
      <ValueMath />
      <PricingFAQ />
      <EnterpriseCTA />

      {/* SERP-eligible structured data: each pricing FAQ becomes a featured
          snippet candidate, and the breadcrumb pins the page to the brand
          hierarchy in result rows. */}
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Pricing", href: "/pricing" },
        ]}
      />
      <FaqPageJsonLd id="ld-faq-pricing" items={PRICING_FAQ} />
    </>
  );
}

/* ─── Tier grid ─────────────────────────────────────────────────────────── */

function PricingGrid() {
  return (
    <section className="px-5 lg:px-8 pb-20">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
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
          ? "border-primary border-2 shadow-card-lg relative"
          : "h-full"
      }
    >
      {definition.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="default" className="px-3 py-1">
            Most popular
          </Badge>
        </div>
      )}
      <CardContent className="p-6 space-y-5 h-full flex flex-col">
        <div>
          <div className="font-semibold text-lg tracking-tight">
            {definition.label}
          </div>
          <div className="text-xs text-muted-foreground mt-1 min-h-[2.5em] leading-relaxed">
            {definition.tagline}
          </div>
        </div>

        <div>
          <div className="flex items-baseline">
            <span className="font-display text-4xl font-semibold tabular-nums">
              {definition.priceDisplay}
            </span>
            <span className="text-sm text-muted-foreground ml-1.5">
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
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
              <span className="leading-relaxed">{feature}</span>
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

/* ─── Feature matrix ─────────────────────────────────────────────────────── */

function FeatureMatrix() {
  const tiers = PUBLIC_TIERS_IN_ORDER;

  return (
    <section className="px-5 lg:px-8 py-20 bg-secondary/30 border-y border-border/60">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-strong">
            Compare features
          </div>
          <h2 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight">
            What's in each tier
          </h2>
        </div>

        <Card className="overflow-x-auto p-0">
          {/* min-w forces horizontal scroll on phones instead of squashing
              the 5-column comparison into unreadable cells. */}
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-secondary/40 border-b border-border/60">
              <tr>
                <th className="text-left px-5 py-3.5 font-medium text-muted-foreground">
                  Feature
                </th>
                {tiers.map((t) => (
                  <th
                    key={t}
                    className="text-center px-5 py-3.5 font-medium text-foreground"
                  >
                    {TIER_DEFINITIONS[t].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="px-5 py-3.5 font-medium">{row.label}</td>
                  {tiers.map((tier) => (
                    <td key={tier} className="px-5 py-3.5 text-center">
                      <FeatureCellRender value={row.cells[tier]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </section>
  );
}

function FeatureCellRender({ value }: { value: boolean | string }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="h-4 w-4 text-success inline-block" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground/40 inline-block" />
    );
  }
  return <span className="text-foreground/80 text-sm">{value}</span>;
}

/* ─── Value math ─────────────────────────────────────────────────────────── */

function ValueMath() {
  const tiers: PlanTier[] = ["starter", "growth", "pro"];
  return (
    <section className="px-5 lg:px-8 py-20 lg:py-24">
      <div className="max-w-5xl mx-auto space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-strong">
            Value math
          </div>
          <h2 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight">
            Each tier pays for itself on one event
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            No theoretical savings. Just events we surface that you can verify
            in your own records.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {tiers.map((tier) => {
            const def = TIER_DEFINITIONS[tier];
            if (!def.breakEven) return null;
            return (
              <Card key={tier} className="p-6">
                <CardContent className="p-0 space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                    {def.label}
                  </div>
                  <div className="font-display text-2xl font-semibold tabular-nums">
                    {def.breakEven.totalCostDisplay}
                  </div>
                  <div className="border-t border-border/60 pt-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
                      Breaks even on
                    </div>
                    <p className="font-medium text-sm">{def.breakEven.event}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
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

/* ─── Pricing FAQ ────────────────────────────────────────────────────────── */

function PricingFAQ() {
  return (
    <section className="px-5 lg:px-8 py-20 lg:py-24 bg-secondary/30 border-y border-border/60">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-strong">
            Pricing FAQ
          </div>
          <h2 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight">
            Pricing questions
          </h2>
        </div>

        {/* Same FAQ data as the FaqPageJsonLd block below — required for the
            rich-results check that matches structured data to on-page text. */}
        <dl className="space-y-4">
          {PRICING_FAQ.map((qa) => (
            <FAQItem key={qa.question} q={qa.question} a={qa.answer} />
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ─── Enterprise CTA ─────────────────────────────────────────────────────── */

function EnterpriseCTA() {
  const enterprise = TIER_DEFINITIONS.enterprise;
  return (
    <section className="px-5 lg:px-8 py-20 lg:py-24">
      <div className="max-w-5xl mx-auto">
        <Card className="border-2 border-primary/20 shadow-card-lg">
          <CardContent className="p-8 md:p-12 grid md:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-start">
            <div className="space-y-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-primary-strong font-semibold">
                {enterprise.label}
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
                More than 500 subscriptions or need custom terms?
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Enterprise plans start at $
                {enterprise.annualUsd.toLocaleString("en-US")}/year and include
                SAML SSO, a dedicated CSM, a 4-hour guided onboarding, a 7-year
                audit log archive, and a contracted SLA.
              </p>
              <p className="text-sm text-muted-foreground/90">
                Prefer email?{" "}
                <a
                  href="mailto:hello@renewalradar.com?subject=Enterprise%20inquiry"
                  className="underline underline-offset-4 text-foreground hover:text-primary-strong"
                >
                  hello@renewalradar.com
                </a>{" "}
                — we reply within one business day.
              </p>
            </div>

            {/* Same canonical form as every other surface. The `source`
                tag is what lets the marketing team route the lead. */}
            <LeadCaptureForm
              source="marketing_pricing_enterprise"
              intent="enterprise"
              heading="Tell us about your needs"
              description="Subscription count, target start date, anything we should know."
              submitLabel="Request a quote"
              successHeading="Quote request received."
              successMessage="A human will reach out within one business day. If it's urgent, email hello@renewalradar.com."
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
