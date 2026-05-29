import type { Metadata } from "next";
import { HeroBanner } from "@ui/components/shared/hero-banner";
import {
  ArticleJsonLd,
  BreadcrumbJsonLd,
} from "@ui/components/seo/structured-data";

// EEAT freshness markers — bump LAST_REVIEWED on every meaningful edit.
const PUBLISHED = "2026-05-01";
const LAST_REVIEWED = "2026-05-28";

export const metadata: Metadata = {
  // Title template in the root layout appends " · Renewal Radar".
  title: "Privacy policy",
  description:
    "How Renewal Radar collects, uses, and protects your data. Account information, contract content, audit-log metadata, and our subprocessor list — all explained plainly.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy policy — Renewal Radar",
    description: "Plain-language privacy policy.",
    url: "/privacy",
    type: "article",
  },
};

// ⚠️ REVIEW BEFORE PUBLIC LAUNCH ⚠️
// This is publication-quality boilerplate that reflects what the product
// actually does — but it has not been reviewed by counsel for your specific
// jurisdiction. Before opening signups to the public:
//   1. Have counsel review (or use Termly / Iubenda)
//   2. Update the "Effective" date below
//   3. Confirm the contact email is monitored
//   4. Add any state/region-specific disclosures required by your customer base

export default function PrivacyPage() {
  return (
    <>
      <HeroBanner
        eyebrow="Legal · Privacy"
        title="Privacy policy"
        description="How Renewal Radar collects, uses, and protects your data. Plain language; sections are short."
        compact
        metaBelow={
          <span>
            <span className="font-medium text-foreground">Last reviewed</span>{" "}
            <time dateTime={LAST_REVIEWED}>{LAST_REVIEWED}</time> · Published{" "}
            <time dateTime={PUBLISHED}>{PUBLISHED}</time>
          </span>
        }
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Privacy", href: "/privacy" },
        ]}
      />
      <ArticleJsonLd
        headline="Renewal Radar privacy policy"
        description="How Renewal Radar collects, uses, and protects customer data."
        datePublished={PUBLISHED}
        dateModified={LAST_REVIEWED}
        url="/privacy"
      />
      <main className="max-w-2xl mx-auto px-5 lg:px-8 pb-20 prose prose-sm prose-neutral">
        <p>
          Renewal Radar provides SaaS subscription and renewal management
          software (the "Service"). This Privacy Policy describes how we
          collect, use, and protect information when you use the Service. By
          using Renewal Radar, you agree to the practices described here.
        </p>

        <h2>1. Information we collect</h2>

      <p>
        <strong>Account information.</strong> When you sign up, we collect
        your name, work email address, and (optionally) your company name.
        Authentication is handled by our identity provider, Clerk, which
        receives and stores your password securely on our behalf. We never
        receive or store your password ourselves.
      </p>

      <p>
        <strong>Subscription and contract data.</strong> We collect the
        SaaS subscription information you enter — vendor names, products,
        plans, billing cycles, prices, term dates, notice periods, seat
        counts, and any notes you choose to add. This data is the core of
        the Service.
      </p>

      <p>
        <strong>Billing information.</strong> When you upgrade to a paid
        plan, our billing provider Stripe collects your payment method,
        billing address, and tax ID (if applicable). We do not receive or
        store your full payment card number. We see only the last four digits
        and card type for our records.
      </p>

      <p>
        <strong>Usage data.</strong> Our analytics provider Plausible
        collects anonymous, aggregate page-view metrics. We do not use
        cross-site tracking cookies. Our error tracking provider Sentry
        receives crash reports that may include IP address and browser
        information — never your subscription data.
      </p>

      <p>
        <strong>Communications.</strong> If you email us, we retain the
        email and our response. If you have a paid plan, we may store
        notes from support conversations.
      </p>

      <h2>2. How we use information</h2>

      <p>
        We use your information to:
      </p>
      <ul>
        <li>Operate the Service — track your subscriptions, calculate notice deadlines, send alerts you have requested</li>
        <li>Bill you accurately if you have a paid plan</li>
        <li>Communicate with you about your account, security, and product changes</li>
        <li>Improve the Service through aggregate analytics</li>
        <li>Comply with legal obligations</li>
      </ul>

      <h2>3. What we do not do with your data</h2>

      <p>
        This is the part most other SaaS management products handle
        differently. We commit to:
      </p>
      <ul>
        <li><strong>We do not sell your data.</strong> Ever.</li>
        <li><strong>We do not pool your contract or pricing data into a benchmark dataset.</strong> Other vendors in this space anonymize and aggregate customer data to sell "industry benchmarks." We do not.</li>
        <li><strong>We do not send communications to your vendors on your behalf.</strong> When you decide to cancel a subscription, we generate a draft cancellation letter — you send it from your own email client.</li>
        <li><strong>We do not connect to your bank or card accounts.</strong> Subscription discovery in V1 uses CSV uploads and forwarded vendor invoices only.</li>
        <li><strong>We do not log into vendor websites on your behalf.</strong> No browser automation, no robotic process automation.</li>
      </ul>

      <h2>4. How we share information</h2>

      <p>
        We share your information only with the service providers required
        to operate the Service:
      </p>
      <ul>
        <li><strong>Clerk</strong> (authentication)</li>
        <li><strong>Stripe</strong> (payment processing)</li>
        <li><strong>Vercel</strong> (hosting)</li>
        <li><strong>Neon</strong> (database)</li>
        <li><strong>Resend</strong> (transactional email)</li>
        <li><strong>Inngest</strong> (scheduled jobs)</li>
        <li><strong>Sentry</strong> (error tracking)</li>
        <li><strong>Plausible</strong> (analytics)</li>
      </ul>
      <p>
        Each of these providers operates under their own privacy policies and
        Data Processing Agreements (DPAs). They process data only as needed
        to deliver their service to us.
      </p>

      <p>
        We may also disclose information if required by law, court order, or
        valid legal process. If this occurs, we will notify you unless legally
        prohibited from doing so.
      </p>

      <h2>5. Data retention</h2>

      <p>
        We retain your data for as long as your account is active. If you
        cancel your account, your data is retained for 60 days (to allow
        recovery if cancellation was a mistake) and then permanently deleted.
        For Enterprise-tier customers, audit logs may be retained for up to
        7 years upon request.
      </p>

      <h2>6. Your rights</h2>

      <p>
        Depending on your jurisdiction, you may have rights to:
      </p>
      <ul>
        <li>Access the personal information we hold about you</li>
        <li>Correct inaccurate information</li>
        <li>Delete your information (subject to our retention obligations)</li>
        <li>Export your information in a portable format</li>
        <li>Object to or restrict certain processing</li>
        <li>Opt out of marketing communications (transactional emails about your account and notice deadlines continue)</li>
      </ul>

      <p>
        Exercise any of these rights by emailing{" "}
        <a href="mailto:privacy@renewalradar.com">privacy@renewalradar.com</a>.
        We respond within 30 days.
      </p>

      <h2>7. Security</h2>

      <p>
        We protect your data using industry-standard practices:
      </p>
      <ul>
        <li>HTTPS / TLS for all data in transit</li>
        <li>Encryption at rest for the database and file storage</li>
        <li>Authentication via Clerk (supports 2FA on request)</li>
        <li>Webhook signature verification for all incoming third-party events</li>
        <li>Role-based access controls within accounts</li>
        <li>Audit logs of every state-changing action</li>
      </ul>

      <p>
        No system is perfect. If you believe your account has been compromised,
        contact us immediately at{" "}
        <a href="mailto:security@renewalradar.com">security@renewalradar.com</a>.
      </p>

      <h2>8. Children</h2>

      <p>
        The Service is not directed at individuals under 18 years of age. We
        do not knowingly collect information from anyone under 18.
      </p>

      <h2>9. International users</h2>

      <p>
        Renewal Radar is operated from the United States. Your data is stored
        on US-based infrastructure (AWS, via Neon). By using the Service from
        outside the US, you consent to the transfer of your information to the
        United States.
      </p>

      <h2>10. Changes to this policy</h2>

      <p>
        We may update this Privacy Policy from time to time. If we make
        material changes, we will notify you by email and post the updated
        policy here. Continued use of the Service after the effective date
        constitutes acceptance.
      </p>

      <h2>11. Contact</h2>

      <p>
        For privacy questions:{" "}
        <a href="mailto:privacy@renewalradar.com">privacy@renewalradar.com</a>
        <br />
        For security disclosure:{" "}
        <a href="mailto:security@renewalradar.com">security@renewalradar.com</a>
        <br />
        For everything else:{" "}
        <a href="mailto:hello@renewalradar.com">hello@renewalradar.com</a>
      </p>
      </main>
    </>
  );
}
