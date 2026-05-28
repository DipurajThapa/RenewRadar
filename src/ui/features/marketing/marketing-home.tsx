import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  Check,
  FileText,
  Lock,
  Mail,
  Plus,
  Shield,
  Zap,
} from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card, CardContent } from "@ui/components/primitives/card";
import { FAQItem } from "@ui/components/shared/faq-item";
import {
  TEASER_TIERS_IN_ORDER,
  TIER_DEFINITIONS,
  type TierDefinition,
} from "@server/domain/billing/tier-definitions";
import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";

export function MarketingHome() {
  return (
    <div className="bg-white">
      <MarketingNav />

      <Hero />
      <SocialProofStrip />
      <HowItWorks />
      <WedgeSpotlight />
      <FeatureGrid />
      <PricingTeaser />
      <DifferentiationSection />
      <FAQ />
      <FinalCTA />

      <MarketingFooter />
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="px-6 pt-16 md:pt-24 pb-12 md:pb-20">
      <div className="max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-900 text-xs font-medium mb-6">
          <AlertTriangle className="h-3.5 w-3.5" />
          69% of SaaS contracts auto-renew. Most teams miss the notice window.
        </div>

        <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
          Never miss a notice deadline again.
        </h1>

        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Renewal Radar tracks every SaaS subscription, sends escalating alerts
          before each notice deadline, and drafts the cancellation letter when
          you decide to cancel — <strong className="text-foreground">you</strong> click send.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="text-base">
            <Link href="/sign-up">
              Start free — no credit card →
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="text-base">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Free Forever (5 subscriptions) · 14-day Starter trial · cancel any time
        </p>
      </div>

      {/* Visual placeholder: dashboard preview */}
      <div className="max-w-5xl mx-auto mt-16 md:mt-20">
        <div className="rounded-xl border-2 border-foreground/10 shadow-2xl overflow-hidden bg-gradient-to-br from-muted/30 to-muted/60">
          <div className="bg-white/80 backdrop-blur px-4 py-3 border-b flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            </div>
            <span className="ml-3">renewalradar.com/dashboard</span>
          </div>
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <div className="p-6 md:p-8 bg-white space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Good morning, Dipuraj.</h3>
        <p className="text-xs text-muted-foreground mt-1">
          4 notice deadlines in next 30 days · 11 renewals in next 90 days
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <PreviewCard
          tone="red"
          icon={<AlertTriangle className="h-4 w-4" />}
          count={2}
          label="notice deadlines in action window"
        />
        <PreviewCard
          tone="yellow"
          icon={<Calendar className="h-4 w-4" />}
          count={3}
          label="renewals awaiting decision"
        />
        <PreviewCard tone="green" count={0} label="all clear on contracts" />
      </div>

      <div className="rounded-md border p-4 mt-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
          Notice Deadline Spotlight
        </div>
        <div className="space-y-2.5">
          <PreviewRow
            vendor="Atlassian"
            product="Jira Software"
            urgency="ACTION NEEDED · in 3 days"
            value="$12,000/yr"
            tone="red"
          />
          <PreviewRow
            vendor="Datadog"
            product="Pro Plan"
            urgency="ACTION NEEDED · in 6 days"
            value="$8,400/yr"
            tone="orange"
          />
          <PreviewRow
            vendor="Figma"
            product="Organization"
            urgency="NOTICE WINDOW · in 18 days"
            value="$3,780/yr"
            tone="yellow"
          />
        </div>
      </div>
    </div>
  );
}

function PreviewCard({
  tone,
  icon,
  count,
  label,
}: {
  tone: "red" | "yellow" | "green";
  icon?: React.ReactNode;
  count: number;
  label: string;
}) {
  const cls = {
    red: "border-red-200 bg-red-50",
    yellow: "border-yellow-200 bg-yellow-50",
    green: "border-green-200 bg-green-50",
  }[tone];
  return (
    <div className={`rounded-md border ${cls} p-3`}>
      <div className="flex items-start gap-2">
        {tone === "green" ? <Check className="h-4 w-4 text-green-600" /> : icon}
        <div className="text-xs">
          {tone === "green" ? (
            <span>All clear — no {label}</span>
          ) : (
            <>
              <span className="text-xl font-bold leading-none">{count}</span>{" "}
              <span className="text-muted-foreground">{label}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewRow({
  vendor,
  product,
  urgency,
  value,
  tone,
}: {
  vendor: string;
  product: string;
  urgency: string;
  value: string;
  tone: "red" | "orange" | "yellow";
}) {
  const dot = {
    red: "bg-red-500",
    orange: "bg-orange-500",
    yellow: "bg-yellow-500",
  }[tone];
  const text = {
    red: "text-red-700",
    orange: "text-orange-700",
    yellow: "text-yellow-800",
  }[tone];
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
        <div className="min-w-0">
          <div className="font-medium truncate">
            {vendor} <span className="text-muted-foreground">— {product}</span>
          </div>
          <div className={`${text} mt-0.5`}>{urgency}</div>
        </div>
      </div>
      <div className="font-medium tabular-nums shrink-0">{value}</div>
    </div>
  );
}

// ─── Social Proof Strip ──────────────────────────────────────────────────

function SocialProofStrip() {
  return (
    <section className="border-y bg-muted/20 py-6">
      <div className="max-w-5xl mx-auto px-6 text-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Built for IT and Ops leads at companies like
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground/70 font-medium">25–500 employees</span>
          {" "}·{" "}<span className="text-foreground/70 font-medium">30+ SaaS subscriptions</span>
          {" "}·{" "}<span className="text-foreground/70 font-medium">no IT department to call</span>
        </p>
      </div>
    </section>
  );
}

// ─── How It Works ────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-20 md:py-28">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            From signup to first prevented loss in under 30 minutes
          </h2>
          <p className="mt-4 text-muted-foreground">
            Three steps. No integrations needed. No bank or card connections.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          <Step
            number={1}
            icon={<Plus />}
            title="Add your subscriptions"
            body="Type in vendor, product, term dates, and price. Under 90 seconds each. No CSV required — though you can paste one if you want."
          />
          <Step
            number={2}
            icon={<Calendar />}
            title="We watch every deadline"
            body="Renewal Radar calculates the notice deadline for every subscription and sends escalating email alerts at 30, 14, 7, 3, and 1 days before."
          />
          <Step
            number={3}
            icon={<FileText />}
            title="We draft, you send"
            body="When you decide to cancel, we generate a vendor-ready letter. You review, click 'open in my mail client,' and send it from your own email."
          />
        </div>
      </div>
    </section>
  );
}

function Step({
  number,
  icon,
  title,
  body,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="relative">
      <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold">
        {number}
      </div>
      <Card className="h-full pt-6">
        <CardContent className="space-y-3">
          <div className="text-foreground/70 [&>svg]:h-6 [&>svg]:w-6">
            {icon}
          </div>
          <h3 className="font-semibold text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Wedge Feature Spotlight ─────────────────────────────────────────────

function WedgeSpotlight() {
  return (
    <section className="px-6 py-20 md:py-24 bg-gradient-to-b from-muted/20 to-muted/40">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-200/60 text-amber-900 text-xs font-medium mb-4">
            <Mail className="h-3 w-3" />
            The wedge feature
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            The Cancellation Letter Generator
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            When you decide to cancel a subscription, Renewal Radar drafts a
            ready-to-send cancellation letter with the vendor's specific notice
            requirements baked in.
          </p>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Fill in your name and company once — the letter populates with the
            right vendor address, the right notice deadline date, and the right
            term-end language. Two clicks: <em>"Open in my email"</em> or
            <em> "Copy to clipboard"</em>.
          </p>

          <div className="mt-6 rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm">
            <strong>The principle:</strong> Renewal Radar never sends emails to
            vendors on your behalf. We prepare the letter; you click send.
            This isn't a limitation — it's the architecture.
          </div>
        </div>

        <div className="rounded-xl border-2 border-amber-200 bg-white shadow-xl overflow-hidden">
          <div className="bg-amber-100 px-5 py-3 border-b border-amber-200 text-xs font-semibold text-amber-900">
            Cancellation letter draft
          </div>
          <div className="p-5 space-y-3 text-xs font-mono whitespace-pre-wrap leading-relaxed">
            <div className="text-muted-foreground">Subject:</div>
            <div className="font-sans bg-muted/30 rounded px-2 py-1.5 text-xs">
              Notice of Cancellation — Atlassian — Jira Software
            </div>
            <div className="text-muted-foreground mt-3">Body:</div>
            <div className="font-sans text-xs text-foreground/80">
              To Whom It May Concern at Atlassian,
              <br /><br />
              This letter constitutes formal written notice that Acme Corp
              will not renew our subscription to Jira Software, effective
              at the end of the current term (Jul 14, 2026).
              <br /><br />
              This notice is being provided in accordance with the notice
              period specified in our agreement (account ID: ACME-12345).
              <br /><br />
              Please confirm receipt in writing...
            </div>
            <div className="flex gap-2 pt-2">
              <div className="text-xs bg-foreground text-background px-3 py-1.5 rounded-md font-sans">
                ✉  Open in my email client
              </div>
              <div className="text-xs border px-3 py-1.5 rounded-md font-sans">
                📋  Copy
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Feature Grid ────────────────────────────────────────────────────────

function FeatureGrid() {
  return (
    <section id="features" className="px-6 py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Built for the work, not the demo
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every feature exists because it stops a loss or saves time. No bloat,
            no integrations you'd never use, no marketing fluff.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Escalating notice alerts"
            body="Emails at 30, 14, 7, 3, and 1 days before each deadline. The 7/3/1-day alerts are non-mutable — they exist to keep you safe from yourself."
          />
          <FeatureCard
            icon={<Calendar className="h-5 w-5" />}
            title="Renewal Calendar"
            body="Every subscription's renewal date in one 12-month view. Color-coded by urgency. One click to the decision workflow."
          />
          <FeatureCard
            icon={<FileText className="h-5 w-5" />}
            title="Decide-Now workflow"
            body="See the stakes (annual value at risk), pick a decision (renew, adjust, cancel, downgrade), and we log it with a full audit trail."
          />
          <FeatureCard
            icon={<Zap className="h-5 w-5" />}
            title="Multi-license per vendor"
            body="Track 3 Atlassian products separately under one vendor. Multi-cycle, multi-product, multi-team — visible per-vendor and rolled up."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="pt-6 space-y-3">
        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center text-foreground/70">
          {icon}
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}

// ─── Pricing Teaser (data derives from TIER_DEFINITIONS — no duplication) ─

function PricingTeaser() {
  return (
    <section className="px-6 py-20 md:py-24 bg-muted/20">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Pricing that pays for itself in one prevented miss
          </h2>
          <p className="mt-4 text-muted-foreground">
            One avoided $1K auto-renewal pays for the whole year of Starter.
            We're not estimating savings — every event is verifiable in your
            own invoice history.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {TEASER_TIERS_IN_ORDER.map((tier) => (
            <PriceCard key={tier} definition={TIER_DEFINITIONS[tier]} />
          ))}
        </div>

        <div className="text-center">
          <Button asChild variant="outline">
            <Link href="/pricing">See full plan comparison →</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function PriceCard({ definition }: { definition: TierDefinition }) {
  return (
    <Card
      className={
        definition.highlighted ? "border-foreground border-2 shadow-lg" : ""
      }
    >
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{definition.label}</div>
          {definition.highlighted && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-foreground text-background">
              Recommended
            </span>
          )}
        </div>
        <div>
          <span className="text-3xl font-bold tabular-nums">
            {definition.priceDisplay}
          </span>
          <span className="text-sm text-muted-foreground ml-1">
            {definition.priceCadence}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {definition.teaserDescription}
        </p>
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

// ─── Differentiation Section ─────────────────────────────────────────────

function DifferentiationSection() {
  return (
    <section className="px-6 py-20 md:py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            What makes Renewal Radar different
          </h2>
          <p className="mt-4 text-muted-foreground">
            Most SaaS management tools either lock you into a data-sharing
            scheme or quietly send communications to your vendors on your behalf.
            We do neither.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <DiffCard
            icon={<Shield className="h-5 w-5" />}
            title="No data pooling, ever"
            body="We don't anonymize your contract terms and sell them back to the market as 'industry benchmarks.' Your data is yours."
            counter="vs. SpendHound's give-to-get model"
          />
          <DiffCard
            icon={<Lock className="h-5 w-5" />}
            title="Advisor, never agent"
            body="We never send emails to your vendors. We never log into vendor portals. We draft the letter; you click send from your own email."
            counter="vs. RPA-based cancellation services"
          />
          <DiffCard
            icon={<Zap className="h-5 w-5" />}
            title="Under 30 minutes to first value"
            body="No integrations to set up. No CSV templates to wrangle. Add a subscription manually in 90 seconds and the dashboard is live."
            counter="vs. multi-week enterprise SMP implementations"
          />
          <DiffCard
            icon={<Check className="h-5 w-5" />}
            title="Public, transparent pricing"
            body="Free Forever, $79/mo Starter, $299/mo Growth, $899/mo Pro. No 'contact sales for pricing' games on the SMB tiers."
            counter="vs. Vendr, Sastrify, Tropic hiding pricing"
          />
        </div>
      </div>
    </section>
  );
}

function DiffCard({
  icon,
  title,
  body,
  counter,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  counter: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-foreground/5 flex items-center justify-center text-foreground/70">
            {icon}
          </div>
          <h3 className="font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        <p className="text-xs text-muted-foreground/70 italic border-t pt-2">
          {counter}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────

function FAQ() {
  return (
    <section id="faq" className="px-6 py-20 md:py-24 bg-muted/20">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Common questions
          </h2>
        </div>

        <dl className="space-y-6">
          <FAQItem
            q="Is the Free Forever plan actually free? What's the catch?"
            a="Yes, really free. Up to 5 subscriptions tracked, single user, email alerts on notice deadlines. The cap nudges teams who get serious about the product to upgrade to Starter — but there's no time limit and no credit card required to use it forever."
          />
          <FAQItem
            q="How is this different from SpendHound or Vendr?"
            a="SpendHound is free because customers contribute their contract terms to a shared benchmark dataset. Vendr operates negotiation services. We do neither. Renewal Radar is paid software that watches deadlines and drafts cancellation letters — you stay in control of every external communication."
          />
          <FAQItem
            q="Do I need to set up any integrations?"
            a="No. Renewal Radar works from manual entry alone. You add subscriptions by typing in the vendor, product, term, and price. CSV import and forwarded-invoice parsing ship in V1.5; vendor APIs in V2. Day one works without anything connected."
          />
          <FAQItem
            q="What about my employees buying SaaS on personal cards?"
            a="V1 doesn't catch shadow IT. We're honest about that — the wedge is contract-level notice deadlines, not credit card monitoring. If shadow IT discovery is your primary pain, Nudge Security is a great free starting point."
          />
          <FAQItem
            q="Can I cancel my Renewal Radar subscription any time?"
            a="Yes, one click in your Stripe customer portal. We give a prorated refund within 60 days of your most recent payment. No retention pitches, no friction. The whole point is that you stay because the product works, not because cancellation is hard."
          />
          <FAQItem
            q="Do you actually cancel my vendor subscriptions for me?"
            a="No, and we never will. We draft a vendor-ready cancellation letter and pre-populate your email client. You review and click send. This is a binding architectural principle — the product is an advisor, never an agent. If you want managed cancellation, services like Trim exist for that."
          />
        </dl>
      </div>
    </section>
  );
}

// (FAQItem now lives in @/components/shared/faq-item)

// ─── Final CTA ───────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="px-6 py-20 md:py-28">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          One prevented missed renewal pays for the year
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Start tracking your subscriptions in the next 5 minutes. No card, no
          integrations, no implementation calls.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="text-base">
            <Link href="/sign-up">Start free →</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="text-base">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Questions? Email <a href="mailto:hello@renewalradar.com" className="underline">hello@renewalradar.com</a> — goes straight to the founder.
        </p>
      </div>
    </section>
  );
}
