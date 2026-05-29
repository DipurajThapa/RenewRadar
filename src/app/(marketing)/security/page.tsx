import type { Metadata } from "next";
import Link from "next/link";
import { HeroBanner } from "@ui/components/shared/hero-banner";
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
} from "@ui/components/seo/structured-data";
import { LeadCaptureForm } from "@ui/features/marketing/lead-capture-form";
import { Card } from "@ui/components/primitives/card";

/**
 * Page-level publishing dates. Both EEAT and GEO grading look for visible
 * "last reviewed" markers — Google specifically prioritises freshness on
 * security/legal content, and LLMs prefer to quote pages with declared
 * revision dates.
 *
 * Bump `LAST_REVIEWED` on every meaningful edit; bump `PUBLISHED` once.
 */
const PUBLISHED = "2026-05-01";
const LAST_REVIEWED = "2026-05-28";

export const metadata: Metadata = {
  // Title template in the root layout appends " · Renewal Radar".
  title: "Security & privacy",
  description:
    "How Renewal Radar protects contract data: AES-256 encryption, tenant isolation enforced per request, transparent subprocessors, configurable retention, and a 72-hour breach notification commitment.",
  alternates: { canonical: "/security" },
  openGraph: {
    title: "Security & privacy — Renewal Radar",
    description:
      "Encryption, isolation, retention, and incident response — documented in plain language.",
    url: "/security",
    type: "article",
  },
};

const SECTIONS = [
  { id: "data-handling", label: "Data handling" },
  { id: "encryption", label: "Encryption" },
  { id: "tenant-isolation", label: "Tenant isolation" },
  { id: "subprocessors", label: "Subprocessors" },
  { id: "retention", label: "Retention & deletion" },
  { id: "incidents", label: "Incident response" },
  { id: "contact", label: "Contact" },
];

export default function SecurityPage() {
  return (
    <>
      <HeroBanner
        eyebrow="Security & privacy"
        title="Built so a single team can run it"
        description="Your contract data is the sharpest thing we hold. This page documents how we protect it — encryption, tenant isolation, retention, incident response — and where the gaps are."
        compact
        metaBelow={
          <div className="space-y-1">
            <div>
              <span className="font-medium text-foreground">Last reviewed</span>{" "}
              <time dateTime={LAST_REVIEWED}>{LAST_REVIEWED}</time> · Published{" "}
              <time dateTime={PUBLISHED}>{PUBLISHED}</time> · Reviewed by the
              Renewal Radar engineering team
            </div>
            <div>
              Material changes are logged in the{" "}
              <Link
                href="/settings/audit"
                className="underline underline-offset-4 text-foreground"
              >
                customer audit log
              </Link>
              .
            </div>
          </div>
        }
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Security & privacy", href: "/security" },
        ]}
      />
      <ArticleJsonLd
        headline="Security & privacy at Renewal Radar"
        description="How Renewal Radar protects customer contract data: encryption, tenant isolation, subprocessors, retention, and incident response."
        datePublished={PUBLISHED}
        dateModified={LAST_REVIEWED}
        url="/security"
      />
      <main className="max-w-5xl mx-auto px-5 lg:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10">
          <nav className="space-y-1 text-sm">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </nav>

          <article className="prose prose-sm max-w-none space-y-10">
            <section id="data-handling">
              <h2 className="text-xl font-semibold">Data handling</h2>
              <p>
                Renewal Radar stores the data you give it: vendor names,
                product names, term dates, prices, seat counts, owners, notice
                periods, decisions, and savings amounts. We do not scrape
                vendor portals on your behalf. We do not email vendors on your
                behalf. We do not sell, rent, or monetize your data.
              </p>
              <p>
                In V1 you enter data manually (or via CSV import). Contract
                documents are not uploaded. AI-based clause extraction ships in
                a later release; when it does, every extracted field will
                require human review before it changes production data — that
                is an architectural rule, not a policy preference.
              </p>
            </section>

            <section id="encryption">
              <h2 className="text-xl font-semibold">Encryption</h2>
              <p>
                <strong>In transit.</strong> TLS 1.2+ everywhere. No
                plain-HTTP routes. Our HSTS preload is configured at the edge.
              </p>
              <p>
                <strong>At rest.</strong> Postgres data is encrypted at rest by
                our managed-database provider (Neon). Integration secrets
                (Slack webhook URLs, ICS export tokens) are envelope-encrypted
                per account with AES-256-GCM before being written; the master
                key is held in our deployment platform's secret manager.
              </p>
              <p>
                Backups inherit the encryption of the underlying storage and
                are retained for 14 days.
              </p>
            </section>

            <section id="tenant-isolation">
              <h2 className="text-xl font-semibold">Tenant isolation</h2>
              <p>
                Every table that holds customer data has an{" "}
                <code>account_id</code> column, and every query filters on it.
                The "current account" is resolved server-side from the
                authenticated session — never from a request header or URL
                parameter that a client could forge.
              </p>
              <p>
                A mutation called with a mismatched <code>account_id</code>{" "}
                throws rather than silently no-ops. We run a tenant-isolation
                test suite on every commit that seeds two accounts and asserts
                that no query returns the other account's rows.
              </p>
            </section>

            <section id="subprocessors">
              <h2 className="text-xl font-semibold">Subprocessors</h2>
              <p>
                These are the services that hold customer data on our behalf.
                We will update this list and notify paying customers before
                adding a new subprocessor that materially changes the data
                flow.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <strong>Neon</strong> — managed Postgres (US-East). Stores
                  account, subscription, renewal, and audit-log rows.
                </li>
                <li>
                  <strong>Vercel</strong> — hosting + edge. Runs the
                  application; does not retain customer data beyond request
                  logs (30 days).
                </li>
                <li>
                  <strong>Clerk</strong> — authentication. Holds email
                  addresses and authentication metadata.
                </li>
                <li>
                  <strong>Stripe</strong> — payment processing. Holds billing
                  contact + payment-instrument metadata only.
                </li>
                <li>
                  <strong>Resend</strong> — transactional email delivery.
                  Holds email recipient addresses and the rendered HTML of
                  each message for 7 days.
                </li>
                <li>
                  <strong>Inngest</strong> — background-job orchestration.
                  Holds job-step inputs and outputs for 7 days; we minimize
                  PII in those payloads.
                </li>
                <li>
                  <strong>Sentry</strong> — error monitoring. We scrub stack
                  traces of email addresses and user IDs before send.
                </li>
              </ul>
            </section>

            <section id="retention">
              <h2 className="text-xl font-semibold">Retention & deletion</h2>
              <p>
                <strong>Live data.</strong> We retain customer data for the
                lifetime of the account. Audit log retention is tier-based
                (Free 30 days · Starter 12 mo · Growth 24 mo · Pro 36 mo ·
                Enterprise 7 years) and is enforced by a daily purge job.
              </p>
              <p>
                <strong>Account deletion.</strong> An account owner can
                request deletion via{" "}
                <a
                  href="mailto:privacy@renewalradar.com"
                  className="underline underline-offset-4"
                >
                  privacy@renewalradar.com
                </a>
                . We complete deletion within 30 days. Backups age out within
                another 14 days; after that the data is unrecoverable.
              </p>
              <p>
                <strong>Export.</strong> Subscription and renewal data can be
                exported as CSV from <code>/subscriptions</code> at any time.
                Savings and exposure exports are on the Reports page.
              </p>
            </section>

            <section id="incidents">
              <h2 className="text-xl font-semibold">Incident response</h2>
              <p>
                If we discover a security incident that may have exposed
                customer data, we notify affected paying customers by email
                within 72 hours, with what we know, what we don't yet know,
                what we've done, and what we recommend you do.
              </p>
            </section>

            <section id="contact">
              <h2 className="text-xl font-semibold">Contact</h2>
              <p>
                Security or privacy concerns:{" "}
                <a
                  href="mailto:security@renewalradar.com"
                  className="underline underline-offset-4"
                >
                  security@renewalradar.com
                </a>
                .
              </p>
              <p>
                We respond within one business day. Responsible disclosure of
                vulnerabilities is welcome — we don't have a paid bounty
                program yet, but we do credit reporters in release notes when
                they consent.
              </p>
            </section>
          </article>
        </div>

        {/*
         * Security-questionnaire help: many prospects need to forward our
         * security posture to their compliance team. Capturing them here
         * lets us send the SOC2 / vendor questionnaire on request.
         */}
        <Card className="mt-16 p-6 sm:p-8 border-primary/15 shadow-card-lg">
          <div className="grid md:grid-cols-[1fr_1.1fr] gap-8 lg:gap-12 items-start">
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-primary-strong font-semibold">
                Need more for review?
              </div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Get our security packet
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We send a SOC 2 readiness summary, our subprocessor list,
                and a pre-filled CAIQ-Lite questionnaire on request. We
                reply within one business day.
              </p>
            </div>
            <LeadCaptureForm
              source="marketing_security_newsletter"
              intent="other"
              submitLabel="Send me the packet"
              successHeading="Packet on the way."
              successMessage="Check your inbox within one business day. If we can answer a question now, just reply to that email."
            />
          </div>
        </Card>
      </main>
    </>
  );
}
