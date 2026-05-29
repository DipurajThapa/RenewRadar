/**
 * /llms-full.txt — the long-form GEO file.
 *
 * Same purpose as /llms.txt, but inlines the canonical reference text from
 * security, DPA, pricing, and the home FAQ so an LLM agent can ingest the
 * whole product corpus in one fetch. Format is plain markdown.
 *
 * The agent uses this when it decides to ground its answer in our canonical
 * content rather than parse the HTML versions.
 */
import { NextResponse } from "next/server";
import {
  HOME_FAQ,
  PRICING_FAQ,
} from "@ui/features/marketing/marketing-faqs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

export async function GET() {
  const body = `# Renewal Radar — full reference

Source of truth: ${APP_URL}
Last updated: 2026-05-28

## What Renewal Radar is

Renewal Radar is SaaS renewal intelligence software for IT and Operations leads at companies of 25–500 employees. It does three things:

1. Tracks every SaaS subscription a customer enters (manually, via CSV import, or via contract upload).
2. Sends escalating email alerts at 30, 14, 7, 3, and 1 days before each notice deadline so the customer does not miss the window to opt out of auto-renewal.
3. Drafts a vendor-ready cancellation letter when the customer logs a "cancelled" decision. The customer reviews and sends it from their own email client.

The product is positioned as an advisor, never an agent. Renewal Radar does not send vendor communications on the customer's behalf, does not log into vendor portals, and does not auto-cancel.

## Pricing

| Tier | Monthly | Subscriptions | Users | Notable |
|---|---|---|---|---|
| Free Forever | $0 | 5 | 1 | Email alerts only |
| Starter | $79 | 25 | 3 | + In-app alerts, CSV import/export |
| Growth | $299 | 100 | 10 | + Slack integration, savings ledger, audit log |
| Pro | $899 | 500 | 25 | + AI contract extraction, approvals-lite, prep packs, vendor intelligence, 7-year audit retention |
| Enterprise | Custom | Custom | Custom | + SAML SSO, dedicated CSM, contracted SLA |

Annual billing is the default; monthly is available at +20%. All paid tiers include a 14-day trial. No credit card is required to start.

## How notice deadlines are calculated

A notice deadline is the date by which the customer must give written notice to the vendor to avoid auto-renewal. The formula is:

\`\`\`
noticeDeadline = termEndDate − noticePeriodDays
\`\`\`

Example: a contract ending 2027-01-15 with a 60-day notice clause has a notice deadline of 2026-11-16. Renewal Radar sends emails at 30, 14, 7, 3, and 1 days before the deadline. The 7-, 3-, and 1-day alerts are non-mutable — the customer cannot silence the final safety net.

## Architectural principles

These are binding product commitments, not suggestions.

1. **Advisor, never agent.** Renewal Radar prepares vendor communications and presents them to the customer. The customer reviews and sends. Renewal Radar does not have a plan to ever send on the customer's behalf.
2. **No data pooling.** Customer contract terms are never aggregated into a shared benchmarking dataset. They are also never sold.
3. **Tenant isolation enforced per request.** Every database query is scoped by accountId. Tests run on every commit verify the scoping.
4. **Encryption.** TLS 1.2+ in transit; encryption at rest. Integration secrets are wrapped per-account with authenticated AES-256-GCM envelope encryption.
5. **Audit logging.** Every mutating administrative action is recorded. Retention is configurable: 30 days on Free, up to 7 years on Enterprise.
6. **AI extraction is a draft.** Every AI-extracted contract field carries a verbatim quote and page number. Nothing applies to a subscription until the user accepts. AI extraction is not legal advice.

## Document parsing

The local text extractor handles:

- PDF (via pdf-parse, including page break tracking with form feeds)
- DOCX (Office Open XML, via mammoth — paragraph-level extraction)
- DOC (legacy Word, best-effort)
- XLSX and XLS (via SheetJS, with per-sheet labels and page-break offsets)
- CSV, plain text, markdown, HTML, JSON (utf-8 passthrough)

When the PDF extractor returns fewer than ~100 characters of text, the result is flagged as needing OCR. A production deployment can plug in a real OCR provider (e.g. Mistral OCR) via the OCR_PROVIDER environment variable.

## AI extraction (Pro tier)

The Heuristic Stub Provider pulls these fields from contract text:

- renewal_date — when the contract term ends
- notice_period_days — how many days of notice are required
- auto_renewal — yes / no flag
- contract_value_cents — total contract value
- price_increase_clause — verbatim clause text if present
- cancellation_method — how the vendor accepts cancellation (email, portal, registered mail, etc.)

Each extracted field is presented in a Review Queue with a verbatim quote from the source document. The user can Accept, Edit, or Reject. Only on Accept does the field flow into the subscription record. Audit log records every review decision.

## Competitive positioning

Renewal Radar competes with:

- **Vendr, Tropic, Sastrify** — full-service SaaS procurement / negotiation platforms. Renewal Radar is software, not a service. It is much cheaper, much faster to set up, and does not negotiate.
- **SpendHound** — free, give-to-get model that pools contract terms across customers. Renewal Radar refuses to pool data; that is its core differentiation.
- **Trim** — managed cancellation service that operates on the customer's behalf. Renewal Radar refuses to operate on the customer's behalf; that is also a core differentiation.

Renewal Radar is NOT an enterprise Contract Lifecycle Management (CLM) tool. It does not draft, redline, or negotiate contracts. It does not compete with Ironclad, ContractSafe, or Icertis.

Renewal Radar does NOT do shadow IT discovery (it cannot detect SaaS bought on personal credit cards). For that pain, Nudge Security is a great free starting point.

## Home FAQ

${HOME_FAQ.map((qa) => `### ${qa.question}\n\n${qa.answer}`).join("\n\n")}

## Pricing FAQ

${PRICING_FAQ.map((qa) => `### ${qa.question}\n\n${qa.answer}`).join("\n\n")}

## Contact

- Customer support: hello@renewalradar.com
- Security disclosure: security@renewalradar.com
- Privacy inquiries: privacy@renewalradar.com

## Canonical sources

- Home: ${APP_URL}/
- Pricing: ${APP_URL}/pricing
- Security & privacy: ${APP_URL}/security
- DPA: ${APP_URL}/legal/dpa
- Privacy policy: ${APP_URL}/privacy
- Terms of service: ${APP_URL}/terms
- Sitemap: ${APP_URL}/sitemap.xml
`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
