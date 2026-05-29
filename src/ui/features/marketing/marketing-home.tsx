import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  FileText,
  Lock,
  Mail,
  Plus,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@ui/components/primitives/button";
import { Card, CardContent } from "@ui/components/primitives/card";
import { Badge } from "@ui/components/primitives/badge";
import { FAQItem } from "@ui/components/shared/faq-item";
import { LeadCaptureForm } from "./lead-capture-form";
import { HOME_FAQ } from "./marketing-faqs";
import {
  TEASER_TIERS_IN_ORDER,
  TIER_DEFINITIONS,
  type TierDefinition,
} from "@server/domain/billing/tier-definitions";
/**
 * Marketing home page.
 *
 * Composition is intentional — each section is a discrete beat:
 *
 *   <Hero />                — display-size headline, dashboard preview
 *   <SocialProofStrip />    — quiet bar that anchors the audience
 *   <HowItWorks />          — three-step value path
 *   <WedgeSpotlight />      — the cancellation letter (the wedge feature)
 *   <FeatureGrid />         — the broader feature surface
 *   <PricingTeaser />       — three tiers, derived from TIER_DEFINITIONS
 *   <DifferentiationSection />
 *                           — what makes us different (vs Vendr/SpendHound)
 *   <FAQ />                 — short, candid answers
 *   <FinalCTA />            — sign-up bar
 *
 * Nav + footer come from the (marketing) layout. This component renders
 * only the sections so the chrome stays consistent across the whole public
 * surface.
 */
export function MarketingHome() {
  return (
    <>
      <Hero />
      <SocialProofStrip />
      <HowItWorks />
      <WedgeSpotlight />
      <FeatureGrid />
      <PricingTeaser />
      <DifferentiationSection />
      <FAQ />
      <FinalCTA />
    </>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative gradient + dot grid backdrop. Pure visual, no semantic
          meaning, so it lives below the content with aria-hidden. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[680px] bg-gradient-to-b from-primary-soft via-background to-background"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[680px] bg-grid bg-grid-fade opacity-50"
      />

      <div className="relative max-w-6xl mx-auto px-6 lg:px-8 pt-20 lg:pt-28 pb-16 lg:pb-24">
        <div className="max-w-3xl mx-auto text-center space-y-7">
          <Badge
            variant="warning-soft"
            className="px-3 py-1 text-xs font-medium gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            69% of SaaS contracts auto-renew. Most teams miss the notice window.
          </Badge>

          <h1 className="font-display text-[44px] sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-[-0.03em]">
            Never miss a notice deadline again.
          </h1>

          <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Renewal Radar tracks every SaaS subscription, alerts you before each
            notice deadline, and drafts a vendor-ready cancellation letter when
            you decide to cancel —{" "}
            <span className="text-foreground font-medium">you</span> click send.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild size="xl">
              <Link href="/dashboard">
                View live demo
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="/sign-up">Start free — no credit card</Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            View the demo without signing up · Free Forever (5 subs) ·
            14-day Starter trial
          </p>
        </div>

        {/* Dashboard preview — uses real product visual language. */}
        <div className="max-w-5xl mx-auto mt-16 lg:mt-20">
          <div className="rounded-xl border border-border/60 shadow-hero overflow-hidden bg-card">
            <div className="bg-secondary/60 px-4 py-3 border-b border-border/60 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-warning/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-success/60" />
              </div>
              <div className="font-mono">renewalradar.com/dashboard</div>
            </div>
            <DashboardPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <div className="p-6 lg:p-8 bg-background space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold tracking-tight">
              Good morning, Dipuraj.
            </h3>
            <Badge variant="success-soft" className="text-[11px] gap-1">
              <Sparkles className="h-3 w-3" />
              Saved YTD $14,820
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            4 notice deadlines in next 30 days · 11 renewals in next 90 days
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="h-1.5 w-1.5 rounded-full bg-success" />
          Live
        </div>
      </div>

      {/* Preview KPIs — stack on phones (< sm = 640px) so each tile keeps
          its headline readable; three across on small tablets and up. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PreviewKpi label="Saved YTD" value="$14,820" tone="success" />
        <PreviewKpi label="Tracked" value="38" />
        <PreviewKpi label="At stake · 30d" value="$24,180" tone="primary" />
      </div>

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
          Notice deadline spotlight
        </div>
        <div className="divide-y divide-border/60">
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

function PreviewKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "success";
}) {
  const cls =
    tone === "success"
      ? "border-success/20 bg-success-soft/70 text-success-soft-foreground"
      : tone === "primary"
        ? "border-primary/20 bg-primary-soft/70 text-primary-strong"
        : "border-border bg-background text-foreground";
  return (
    <div className={`rounded-md border ${cls} px-3 py-2.5`}>
      <div className="text-[10px] uppercase tracking-[0.12em] opacity-80">
        {label}
      </div>
      <div className="font-display text-lg font-semibold tabular-nums leading-tight">
        {value}
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
    red: "bg-destructive",
    orange: "bg-warning",
    yellow: "bg-warning/70",
  }[tone];
  const text = {
    red: "text-destructive",
    orange: "text-warning-soft-foreground",
    yellow: "text-warning-soft-foreground/80",
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`h-2 w-2 rounded-full ${dot} shrink-0`} />
        <div className="min-w-0">
          <div className="font-medium truncate text-sm">
            {vendor}
            <span className="text-muted-foreground font-normal">
              {" "}— {product}
            </span>
          </div>
          <div className={`${text} mt-0.5`}>{urgency}</div>
        </div>
      </div>
      <div className="font-semibold tabular-nums shrink-0">{value}</div>
    </div>
  );
}

/* ─── Social proof ───────────────────────────────────────────────────────── */

function SocialProofStrip() {
  return (
    <section className="border-y border-border/60 bg-secondary/30 py-8">
      <div className="max-w-5xl mx-auto px-6 text-center space-y-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Built for IT and Ops leads at companies like
        </p>
        <p className="text-sm text-foreground/70">
          <span className="text-foreground font-medium">25–500 employees</span>
          {" · "}
          <span className="text-foreground font-medium">30+ SaaS subscriptions</span>
          {" · "}
          <span className="text-foreground font-medium">no IT department to call</span>
        </p>
      </div>
    </section>
  );
}

/* ─── How it works ───────────────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 lg:px-8 py-24 lg:py-28">
      <div className="max-w-6xl mx-auto">
        <SectionHeader
          eyebrow="How it works"
          title="From signup to first prevented loss in under 30 minutes"
          description="Three steps. No integrations. No bank or card connections."
        />

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8 mt-14 animate-stagger">
          <Step
            number={1}
            icon={<Plus />}
            title="Add your subscriptions"
            body="Type in vendor, product, term dates, and price. Under 90 seconds each. CSV import and contract upload are also available."
          />
          <Step
            number={2}
            icon={<Calendar />}
            title="We watch every deadline"
            body="Renewal Radar computes the notice deadline for every subscription and sends escalating email alerts at 30, 14, 7, 3, and 1 days before."
          />
          <Step
            number={3}
            icon={<FileText />}
            title="We draft, you send"
            body="When you decide to cancel, we generate a vendor-ready letter. You review, click 'open in my mail client,' and send from your own email."
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
    <Card className="relative p-7 h-full">
      <div className="absolute -top-3 -left-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-card">
        {number}
      </div>
      <div className="space-y-3.5">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary-strong [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
        <h3 className="font-semibold text-lg tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </Card>
  );
}

/* ─── Wedge spotlight ────────────────────────────────────────────────────── */

function WedgeSpotlight() {
  return (
    <section className="px-6 lg:px-8 py-24 lg:py-28 bg-gradient-to-b from-secondary/40 to-secondary/20 border-y border-border/60">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          <Badge variant="warning-soft" className="mb-4 gap-1.5">
            <Mail className="h-3 w-3" />
            The wedge feature
          </Badge>
          <h2 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight">
            The cancellation letter generator
          </h2>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            When you decide to cancel a subscription, Renewal Radar drafts a
            ready-to-send cancellation letter with the vendor's specific notice
            requirements baked in.
          </p>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Fill in your name and company once — the letter populates with the
            right vendor address, the right notice deadline date, and the right
            term-end language. Two clicks:{" "}
            <em>"Open in my email"</em> or <em>"Copy to clipboard"</em>.
          </p>

          <div className="mt-7 rounded-md border-l-4 border-warning bg-warning-soft/70 px-4 py-3.5 text-sm text-warning-soft-foreground">
            <strong className="block mb-1">The principle</strong>
            Renewal Radar never sends emails to vendors on your behalf. We
            prepare the letter; you click send. That isn't a limitation — it's
            the architecture.
          </div>
        </div>

        <Card className="overflow-hidden border-warning/30 shadow-card-lg">
          <div className="bg-warning-soft/80 px-5 py-3 border-b border-warning/20 text-xs font-semibold uppercase tracking-[0.12em] text-warning-soft-foreground">
            Cancellation letter draft
          </div>
          <div className="p-6 space-y-3.5 leading-relaxed">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
              Subject
            </div>
            <div className="bg-secondary/60 rounded-md px-3 py-2 text-sm font-medium">
              Notice of Cancellation — Atlassian — Jira Software
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mt-3">
              Body
            </div>
            <div className="text-sm text-foreground/80 leading-relaxed">
              To Whom It May Concern at Atlassian,
              <br />
              <br />
              This letter constitutes formal written notice that Acme Corp
              will not renew our subscription to Jira Software, effective at
              the end of the current term (Jul 14, 2026).
              <br />
              <br />
              This notice is being provided in accordance with the notice
              period specified in our agreement (account ID: ACME-12345).
              <br />
              <br />
              Please confirm receipt in writing…
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <div className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5">
                <Mail className="h-3 w-3" />
                Open in my email client
              </div>
              <div className="text-xs border border-border bg-background px-3 py-1.5 rounded-md font-medium">
                Copy to clipboard
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

/* ─── Feature grid ───────────────────────────────────────────────────────── */

function FeatureGrid() {
  return (
    <section id="features" className="px-6 lg:px-8 py-24 lg:py-28">
      <div className="max-w-6xl mx-auto">
        <SectionHeader
          eyebrow="Built for the work"
          title="Every feature exists because it stops a loss"
          description="No bloat, no integrations you'd never use, no marketing fluff."
        />

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 mt-14 animate-stagger">
          <FeatureCard
            icon={<AlertTriangle />}
            title="Escalating notice alerts"
            body="Emails at 30, 14, 7, 3, and 1 days before each deadline. The 7/3/1-day alerts are non-mutable — they exist to keep you safe from yourself."
          />
          <FeatureCard
            icon={<Calendar />}
            title="Renewal calendar"
            body="Every subscription's renewal date in one 12-month view. Colour-coded by urgency. One click to the decision workflow."
          />
          <FeatureCard
            icon={<FileText />}
            title="Decide-Now workflow"
            body="See the stakes (annual value at risk), pick a decision (renew, adjust, cancel, downgrade), and we log it with a full audit trail."
          />
          <FeatureCard
            icon={<Zap />}
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
    <Card interactive className="p-6 h-full">
      <CardContent className="p-0 space-y-3.5">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary-strong [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
        <h3 className="font-semibold text-base tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}

/* ─── Pricing teaser ─────────────────────────────────────────────────────── */

function PricingTeaser() {
  return (
    <section className="px-6 lg:px-8 py-24 lg:py-28 bg-secondary/30 border-y border-border/60">
      <div className="max-w-5xl mx-auto">
        <SectionHeader
          eyebrow="Pricing"
          title="Pricing that pays for itself in one prevented miss"
          description="One avoided $1K auto-renewal pays for a whole year of Starter."
        />

        <div className="grid md:grid-cols-3 gap-5 mt-14 animate-stagger">
          {TEASER_TIERS_IN_ORDER.map((tier) => (
            <PriceCard key={tier} definition={TIER_DEFINITIONS[tier]} />
          ))}
        </div>

        <div className="text-center mt-10">
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">
              See full plan comparison
              <ArrowRight />
            </Link>
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
        definition.highlighted
          ? "border-primary border-2 shadow-card-lg relative bg-card"
          : "bg-card"
      }
    >
      {definition.highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="default" className="px-3 py-1">
            Recommended
          </Badge>
        </div>
      )}
      <CardContent className="p-7 space-y-5">
        <div className="font-semibold text-base tracking-tight">
          {definition.label}
        </div>
        <div>
          <span className="font-display text-4xl font-semibold tabular-nums">
            {definition.priceDisplay}
          </span>
          <span className="text-sm text-muted-foreground ml-1.5">
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

/* ─── Differentiation ────────────────────────────────────────────────────── */

function DifferentiationSection() {
  return (
    <section className="px-6 lg:px-8 py-24 lg:py-28">
      <div className="max-w-6xl mx-auto">
        <SectionHeader
          eyebrow="Why we're different"
          title="What makes Renewal Radar different"
          description="Most SaaS management tools either lock you into a data-sharing scheme or quietly act on your behalf. We do neither."
        />

        <div className="grid md:grid-cols-2 gap-5 mt-14 animate-stagger">
          <DiffCard
            icon={<Shield />}
            title="No data pooling, ever"
            body="We don't anonymize your contract terms and sell them back as 'industry benchmarks.' Your data is yours."
            counter="vs. SpendHound's give-to-get model"
          />
          <DiffCard
            icon={<Lock />}
            title="Advisor, never agent"
            body="We never send emails to your vendors. We never log into vendor portals. We draft the letter; you click send from your own email."
            counter="vs. RPA-based cancellation services"
          />
          <DiffCard
            icon={<Zap />}
            title="Under 30 minutes to first value"
            body="No integrations to set up. No CSV templates to wrangle. Add a subscription manually in 90 seconds and the dashboard is live."
            counter="vs. multi-week enterprise SMP implementations"
          />
          <DiffCard
            icon={<Check />}
            title="Public, transparent pricing"
            body="Free Forever, $79 Starter, $299 Growth, $899 Pro. No 'contact sales for pricing' games on the SMB tiers."
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
    <Card interactive className="p-6">
      <CardContent className="p-0 space-y-3.5">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary-soft text-primary-strong [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </div>
          <h3 className="font-semibold text-base tracking-tight">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        <p className="text-xs text-muted-foreground/70 italic border-t border-border/60 pt-3 mt-3">
          {counter}
        </p>
      </CardContent>
    </Card>
  );
}

/* ─── FAQ ────────────────────────────────────────────────────────────────── */

function FAQ() {
  return (
    <section id="faq" className="px-6 lg:px-8 py-24 lg:py-28 bg-secondary/30 border-y border-border/60">
      <div className="max-w-3xl mx-auto">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
          description="If you don't see your question, email us — we read every message."
        />

        {/* Q/A text is single-sourced from `marketing-faqs.ts` so the FAQPage
            JSON-LD on this page renders the same strings users read. Google's
            structured-data rules require the on-page text to match the schema
            text exactly. */}
        <dl className="space-y-4 mt-12">
          {HOME_FAQ.map((qa) => (
            <FAQItem key={qa.question} q={qa.question} a={qa.answer} />
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ─── Final CTA ──────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative overflow-hidden px-6 lg:px-8 py-24 lg:py-28">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-background via-primary-soft/50 to-background"
      />
      <div className="relative max-w-5xl mx-auto grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-center">
        <div className="space-y-6 text-center lg:text-left">
          <h2 className="font-display text-3xl lg:text-5xl font-semibold leading-tight tracking-tight">
            One prevented miss pays for the year.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Start tracking your subscriptions in the next 5 minutes. No card,
            no integrations, no implementation calls.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 lg:justify-start justify-center pt-1">
            <Button asChild size="xl">
              <Link href="/sign-up">
                Start free
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="/dashboard">View live demo</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Questions?{" "}
            <a
              href="mailto:hello@renewalradar.com"
              className="underline underline-offset-4 hover:text-foreground"
            >
              hello@renewalradar.com
            </a>{" "}
            — goes straight to the founder.
          </p>
        </div>

        {/*
         * Lead-capture form. Sits next to the CTA pair on desktop, stacks
         * below on mobile. The form is a server action under the hood — no
         * client-side fetch logic to maintain.
         */}
        <Card className="p-6 sm:p-7 shadow-card-lg border-primary/15">
          <LeadCaptureForm
            source="marketing_home_final_cta"
            intent="demo"
            heading="Or have us reach out"
            description="Tell us a bit about your team and we'll follow up within one business day."
            submitLabel="Request a follow-up"
            successHeading="Got it — we'll be in touch."
          />
        </Card>
      </div>
    </section>
  );
}

/* ─── Section header used in this file only ─────────────────────────────── */

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="text-center max-w-2xl mx-auto space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-strong">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl lg:text-4xl font-semibold leading-tight tracking-tight">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground leading-relaxed">{description}</p>
      )}
    </div>
  );
}
