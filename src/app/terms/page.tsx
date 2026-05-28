import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Renewal Radar",
  description:
    "Terms under which Renewal Radar provides the Service.",
};

// ⚠️ REVIEW BEFORE PUBLIC LAUNCH ⚠️
// This is publication-quality boilerplate that reflects the product. It has
// not been reviewed by counsel. Before opening public signups:
//   1. Counsel review (or Termly / Iubenda)
//   2. Update "Effective" date below
//   3. Confirm refund terms match what your billing flow actually does
//   4. Confirm governing-law clause matches your business entity's jurisdiction

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-12 prose prose-sm prose-neutral">
      <Link
        href="/"
        className="text-sm text-muted-foreground no-underline hover:underline"
      >
        ← Home
      </Link>

      <h1>Terms of Service</h1>
      <p>
        <em>Effective: [REPLACE WITH LAUNCH DATE]</em>
      </p>

      <p>
        These Terms of Service ("Terms") govern your use of Renewal Radar's
        software-as-a-service product (the "Service"). By creating an account
        or using the Service, you agree to these Terms.
      </p>

      <h2>1. What Renewal Radar does — and doesn't do</h2>

      <p>
        Renewal Radar tracks SaaS subscriptions and their notice deadlines.
        We surface what needs your attention, draft cancellation letters and
        decision artifacts, and record your decisions in an audit log.
      </p>

      <p>
        <strong>We never send communications to your vendors on your
        behalf.</strong> When you decide to cancel a subscription, we generate
        a draft cancellation letter — you send it from your own email
        client. We never act as your agent.
      </p>

      <p>
        We do not provide legal, financial, or procurement advice. The
        recommendations we surface are based on the data you provide and are
        not a substitute for your own judgment or professional counsel.
      </p>

      <h2>2. Your account</h2>

      <p>
        You're responsible for keeping your account credentials secure and for
        all activity under your account. Notify us promptly if you suspect
        unauthorized access at{" "}
        <a href="mailto:security@renewalradar.com">security@renewalradar.com</a>.
      </p>

      <p>
        You must be at least 18 years old to use the Service and must have the
        authority to bind any company you're representing.
      </p>

      <h2>3. Subscription and billing</h2>

      <p>
        <strong>Plans:</strong> Free Forever, Starter, Growth, Pro, and
        Enterprise. Pricing is published at{" "}
        <Link href="/#pricing">renewalradar.com/pricing</Link>. We may change
        pricing with at least 30 days' notice; existing customers continue at
        their current rate until renewal.
      </p>

      <p>
        <strong>Billing:</strong> Paid plans renew automatically at the
        renewal date you choose (monthly or annual). You can cancel anytime
        through the Stripe Customer Portal from your billing settings.
      </p>

      <p>
        <strong>Refunds:</strong> Prorated refund for the unused portion of
        your current billing period if you cancel within 60 days of your most
        recent payment. After 60 days, no refund — your access continues
        through the paid period and ends at the end of the term.
      </p>

      <p>
        <strong>Failed payments:</strong> Standard Stripe dunning applies. If
        your payment fails, you'll receive automated reminders. After
        approximately 21 days of failed attempts, your account reverts to
        Free Forever and continued access is limited.
      </p>

      <p>
        <strong>Taxes:</strong> Prices exclude applicable taxes. Stripe
        collects sales tax in jurisdictions where we're required to charge it.
      </p>

      <h2>4. Acceptable use</h2>

      <p>
        You agree not to:
      </p>
      <ul>
        <li>Use the Service for any unlawful purpose</li>
        <li>Reverse engineer, decompile, or attempt to extract the source code</li>
        <li>Attempt to gain unauthorized access to any system or account</li>
        <li>Interfere with or disrupt the Service or its infrastructure</li>
        <li>Use the Service to send spam, malware, or any unsolicited content</li>
        <li>Resell or sublicense the Service without our written consent</li>
        <li>Use the Service to make automated requests at rates that degrade performance for other users</li>
      </ul>

      <p>
        We may suspend or terminate accounts that violate these terms, with
        notice where practical.
      </p>

      <h2>5. Your data</h2>

      <p>
        You retain all rights to the data you enter into the Service ("Your
        Data"). You grant us a limited license to host, process, and display
        Your Data solely to provide the Service.
      </p>

      <p>
        We do not use Your Data to train machine-learning models. We do not
        sell Your Data. We do not pool Your Data into anonymized benchmarking
        datasets. See our{" "}
        <Link href="/privacy">Privacy Policy</Link> for full details.
      </p>

      <p>
        You can export Your Data at any time from your account settings. After
        account cancellation, we retain Your Data for 60 days, then permanently
        delete it.
      </p>

      <h2>6. Service availability</h2>

      <p>
        We aim for 99.5% uptime but do not guarantee it. The Service may be
        unavailable for scheduled maintenance, upgrades, or unforeseen
        outages. We will provide reasonable notice for planned maintenance.
      </p>

      <p>
        Notice deadline alerts are delivered via scheduled background jobs
        (Inngest). We make commercially reasonable efforts to ensure alerts
        are sent on time, but you remain ultimately responsible for tracking
        your own contract deadlines. We are not liable for any missed
        deadline or its consequences.
      </p>

      <h2>7. Warranty disclaimer</h2>

      <p>
        THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EITHER
        EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES
        OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT,
        OR ACCURACY OF DATA. WE DO NOT WARRANT THAT THE SERVICE WILL BE
        UNINTERRUPTED OR ERROR-FREE.
      </p>

      <h2>8. Limitation of liability</h2>

      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY ARISING
        OUT OF OR RELATING TO THESE TERMS OR THE SERVICE IS LIMITED TO THE
        AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM.
      </p>

      <p>
        WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
        PUNITIVE DAMAGES (INCLUDING LOST PROFITS, LOST DATA, OR MISSED VENDOR
        CANCELLATIONS), EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY.
      </p>

      <h2>9. Indemnification</h2>

      <p>
        You agree to indemnify and hold Renewal Radar harmless from any claim,
        loss, or damage (including attorneys' fees) arising from your use of
        the Service, your data, or your violation of these Terms.
      </p>

      <h2>10. Termination</h2>

      <p>
        You may cancel your account at any time from settings. We may
        terminate or suspend your account for material violations of these
        Terms, non-payment, or extended inactivity. On termination, your
        access ends and your data is retained for 60 days before permanent
        deletion (see Privacy Policy).
      </p>

      <h2>11. Governing law and disputes</h2>

      <p>
        These Terms are governed by the laws of [REPLACE WITH YOUR STATE,
        e.g. Delaware or California], without regard to its conflict of laws
        principles. Any dispute will be resolved in the state or federal
        courts located in [REPLACE WITH COUNTY/CITY].
      </p>

      <p>
        For disputes under $10,000, either party may elect binding arbitration
        through the American Arbitration Association under its Commercial
        Arbitration Rules.
      </p>

      <h2>12. Changes to these terms</h2>

      <p>
        We may update these Terms occasionally. Material changes will be
        announced at least 30 days in advance via email and via a notice
        on this page. Continued use of the Service after changes take effect
        constitutes acceptance.
      </p>

      <h2>13. Contact</h2>

      <p>
        Questions about these Terms:{" "}
        <a href="mailto:legal@renewalradar.com">legal@renewalradar.com</a>
        <br />
        General contact:{" "}
        <a href="mailto:hello@renewalradar.com">hello@renewalradar.com</a>
      </p>
    </main>
  );
}
