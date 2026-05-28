import Link from "next/link";
import { MarketingNav } from "@ui/features/marketing/marketing-nav";
import { MarketingFooter } from "@ui/features/marketing/marketing-footer";

export const metadata = {
  title: "Security & privacy — Renewal Radar",
  description:
    "How Renewal Radar protects contract data: encryption, tenant isolation, subprocessors, retention, and deletion.",
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
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold">Security & privacy</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            We're a paid SaaS for IT / Ops teams. Your contract data is the
            sharpest thing we hold, and the burden of protecting it is on us.
            This page documents how we do that and where the gaps are.
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Last updated 2026-05-28. Material changes go in the{" "}
            <Link
              href="/settings/audit"
              className="underline underline-offset-4"
            >
              audit log
            </Link>{" "}
            for paying customers.
          </p>
        </header>

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
      </main>
      <MarketingFooter />
    </>
  );
}
