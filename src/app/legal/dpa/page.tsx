import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata = {
  title: "Data Processing Addendum — Renewal Radar",
  description:
    "Standard Data Processing Addendum for Renewal Radar customers. Available to Pro and Enterprise customers as part of the contract.",
};

/**
 * Public DPA reference text. Customers on Pro / Enterprise sign this as part
 * of their order form; this page is the canonical, version-stamped copy.
 *
 * Material amendments are versioned (a new "Last updated" date and a note in
 * the changelog at the bottom). The current version is referenced by name in
 * the order form so a customer's DPA can't drift silently.
 */
export default function DpaPage() {
  return (
    <>
      <MarketingNav />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <header className="mb-10">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Legal
          </p>
          <h1 className="text-3xl font-bold mt-2">
            Data Processing Addendum
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-2xl">
            This Data Processing Addendum ("DPA") supplements the Renewal
            Radar Master Service Agreement and applies whenever we process
            Personal Data on behalf of a Customer.
          </p>
          <div className="text-xs text-muted-foreground mt-4 space-y-1">
            <div>Version: 2026-05-A</div>
            <div>Effective: 2026-05-28</div>
          </div>
        </header>

        <article className="prose prose-sm max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold">1. Definitions</h2>
            <p>
              Terms not defined here have the meaning given in Regulation (EU)
              2016/679 ("GDPR") or, where the UK GDPR applies, the equivalent
              UK statutory definition. "Customer" means the entity entering
              into the Master Service Agreement; "Renewal Radar" means
              Renewal Radar, Inc.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. Roles</h2>
            <p>
              Customer is the Controller of Personal Data submitted to the
              Service. Renewal Radar is the Processor and processes Personal
              Data only on documented instructions from Customer, including
              with regard to transfers of Personal Data outside the EEA / UK.
              The Master Service Agreement and the Customer's use of the
              Service constitute the documented instructions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Scope of processing</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Subject matter.</strong> Tracking SaaS subscription
                contracts, notice deadlines, and renewal decisions on behalf
                of Customer.
              </li>
              <li>
                <strong>Duration.</strong> The term of the Master Service
                Agreement plus any post-termination period required to
                complete data export or deletion.
              </li>
              <li>
                <strong>Nature and purpose.</strong> Storage, retrieval,
                aggregation, and delivery (by email, in-app, and Slack) of
                Customer's renewal-tracking data.
              </li>
              <li>
                <strong>Categories of data subjects.</strong> Customer's
                employees and authorized users.
              </li>
              <li>
                <strong>Categories of Personal Data.</strong> Names, work
                email addresses, role, account membership, and audit-log
                metadata recording each user's actions in the Service.
              </li>
              <li>
                <strong>Special categories.</strong> None. Customer agrees not
                to submit special-category data through the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Renewal Radar obligations</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Process Personal Data only on Customer's documented
                instructions.
              </li>
              <li>
                Ensure personnel authorized to process Personal Data are
                committed to confidentiality.
              </li>
              <li>
                Implement and maintain the technical and organizational
                measures described in Section 8 (Security).
              </li>
              <li>
                Notify Customer in writing of any confirmed Personal Data
                Breach within 72 hours of becoming aware of it.
              </li>
              <li>
                Assist Customer in responding to Data Subject Requests
                (access, rectification, erasure, portability) within Service
                administrative controls.
              </li>
              <li>
                Make available, at Customer's reasonable request and not more
                than once per twelve-month period, information necessary to
                demonstrate compliance with this DPA.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Subprocessors</h2>
            <p>
              Customer authorizes Renewal Radar to engage the subprocessors
              listed at{" "}
              <Link
                href="/security#subprocessors"
                className="underline underline-offset-4"
              >
                /security
              </Link>{" "}
              for the purposes described there. Renewal Radar will notify
              Customer at least thirty (30) days in advance of any intended
              addition or replacement of a subprocessor. Customer may object
              in writing on reasonable grounds within fourteen (14) days; in
              that case the parties will work in good faith to find a
              resolution, failing which Customer may terminate the affected
              Service.
            </p>
            <p>
              Renewal Radar imposes data protection obligations on each
              subprocessor materially equivalent to those in this DPA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. International transfers</h2>
            <p>
              Where Renewal Radar transfers Personal Data outside the EEA, UK,
              or Switzerland to a country not subject to an adequacy decision,
              the transfer is governed by the EU Standard Contractual Clauses
              (Commission Implementing Decision 2021/914) or the UK
              International Data Transfer Addendum, as applicable, in their
              then-current form. The clauses are incorporated by reference
              into this DPA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">
              7. Audits and assistance
            </h2>
            <p>
              Renewal Radar will assist Customer in fulfilling its obligations
              under Articles 32–36 GDPR taking into account the nature of the
              processing and the information available to Renewal Radar.
              Audits beyond the materials Renewal Radar makes available will
              be conducted at Customer's expense and no more than once per
              twelve-month period, subject to a confidentiality agreement and
              forty-five (45) days' advance notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Security</h2>
            <p>
              Renewal Radar maintains the security measures described at{" "}
              <Link
                href="/security"
                className="underline underline-offset-4"
              >
                /security
              </Link>{" "}
              and updated from time to time, including:
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Encryption of Personal Data in transit (TLS 1.2+) and at rest.
              </li>
              <li>
                Per-account encryption of integration secrets using
                authenticated symmetric encryption (AES-256-GCM).
              </li>
              <li>
                Tenant isolation enforced by application-level{" "}
                <code>account_id</code> scoping and tested on every commit.
              </li>
              <li>
                Role-based access controls (owner / admin / member / viewer)
                enforced server-side.
              </li>
              <li>
                Audit logging of all mutating administrative actions.
              </li>
              <li>
                Regular dependency-vulnerability monitoring and patch cadence.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">
              9. Retention and deletion
            </h2>
            <p>
              Renewal Radar retains Customer Personal Data for the duration of
              the Master Service Agreement. Audit-log retention is governed by
              Customer's subscription tier and ranges from 30 days (Free) to
              7 years (Enterprise); the configured retention is enforced by
              an automated daily process.
            </p>
            <p>
              On termination, Renewal Radar will, at Customer's choice,
              return or delete all Personal Data within thirty (30) days,
              save to the extent that applicable law requires retention.
              Backups age out within an additional fourteen (14) days; after
              that the data is unrecoverable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">10. Liability</h2>
            <p>
              Each party's liability arising out of or in connection with this
              DPA is subject to the limitations and exclusions of liability
              set out in the Master Service Agreement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">11. Order of precedence</h2>
            <p>
              In the event of a conflict between this DPA and the Master
              Service Agreement, this DPA prevails with respect to the
              processing of Personal Data. Where the Standard Contractual
              Clauses apply, the Clauses prevail over this DPA only with
              respect to international transfers governed by them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">12. Changes to this DPA</h2>
            <p>
              Renewal Radar may update this DPA from time to time. Material
              changes will be communicated at least thirty (30) days in
              advance via email to the Customer's billing contact and via
              this page. Continued use of the Service after the effective
              date of an update constitutes acceptance of the updated DPA.
            </p>
            <div className="rounded-md border bg-muted/30 p-4 mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide">
                Changelog
              </div>
              <ul className="text-sm mt-2 space-y-1">
                <li>
                  <strong>2026-05-A</strong> — Initial publication.
                </li>
              </ul>
            </div>
          </section>

          <section className="border-t pt-6">
            <h2 className="text-xl font-semibold">Contact</h2>
            <p>
              Privacy and data protection inquiries:{" "}
              <a
                href="mailto:privacy@renewalradar.com"
                className="underline underline-offset-4"
              >
                privacy@renewalradar.com
              </a>
              .
            </p>
            <p className="text-xs text-muted-foreground mt-4 italic">
              ⚠ This document is a template provided for reference. Customers
              negotiating a signed DPA should request the version-stamped PDF
              from their account contact, which is the authoritative document.
              This page does not by itself constitute a signed agreement.
            </p>
          </section>
        </article>
      </main>
      <MarketingFooter />
    </>
  );
}
