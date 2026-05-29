import type { Metadata } from "next";
import { Mail, Shield, ShieldQuestion } from "lucide-react";
import { Card } from "@ui/components/primitives/card";
import { HeroBanner } from "@ui/components/shared/hero-banner";
import { LeadCaptureForm } from "@ui/features/marketing/lead-capture-form";
import { BreadcrumbJsonLd } from "@ui/components/seo/structured-data";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach the Renewal Radar team — sales, security, and general inquiries all land with a human within one business day.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact — Renewal Radar",
    description:
      "Reach the team within one business day. No SDR funnel — every message goes to a human.",
    url: "/contact",
    type: "website",
  },
};

/**
 * /contact — a standalone page so direct links work (a customer pasting
 * "renewalradar.com/contact" into Slack expects this to load). The form is
 * the same canonical `LeadCaptureForm` rendered elsewhere; only the page
 * chrome differs.
 *
 * Side rail shows direct email addresses for routing — fastest path when
 * the visitor knows whether they want sales, security, or privacy.
 */
export default function ContactPage() {
  return (
    <>
      <HeroBanner
        eyebrow="Contact"
        title="Talk to a human"
        description="Sales, security, and general inquiries all reach a person within one business day. No SDR funnel."
        compact
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Contact", href: "/contact" },
        ]}
      />

      <main className="max-w-5xl mx-auto px-5 lg:px-8 pb-20">
        <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 lg:gap-12 items-start">
          {/* Direct routes — fast path for visitors who already know who
              they need to reach. */}
          <aside className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Direct
            </h2>
            <ContactCard
              icon={<Mail className="h-4 w-4" />}
              label="General + sales"
              email="hello@renewalradar.com"
              description="Anything not security or privacy. We read every message."
            />
            <ContactCard
              icon={<Shield className="h-4 w-4" />}
              label="Security disclosure"
              email="security@renewalradar.com"
              description="Vulnerability reports and SOC 2 questionnaire requests."
            />
            <ContactCard
              icon={<ShieldQuestion className="h-4 w-4" />}
              label="Privacy + DPA"
              email="privacy@renewalradar.com"
              description="GDPR / CCPA inquiries, DPA requests, deletion requests."
            />
          </aside>

          <Card className="p-6 sm:p-8 shadow-card-lg border-primary/15">
            {/* Same canonical form as every other surface. */}
            <LeadCaptureForm
              source="marketing_demo_request"
              intent="other"
              heading="Or send us a message"
              description="Tell us a bit about what you're working on. We'll reply within one business day."
              submitLabel="Send message"
              successHeading="Message received."
              successMessage="A human will get back to you within one business day. For something time-sensitive, email hello@renewalradar.com."
            />
          </Card>
        </div>
      </main>
    </>
  );
}

function ContactCard({
  icon,
  label,
  email,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  email: string;
  description: string;
}) {
  return (
    <Card className="p-5 hover:border-border/70 transition-colors">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary-strong shrink-0">
          {icon}
        </span>
        <div className="space-y-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">
            {label}
          </div>
          <a
            href={`mailto:${email}`}
            className="font-medium text-foreground hover:text-primary-strong transition-colors break-all"
          >
            {email}
          </a>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </Card>
  );
}
