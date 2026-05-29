/**
 * /llms.txt — the short-form GEO file consumed by LLM-based search agents
 * (Perplexity, ChatGPT browsing, Anthropic AI Search, etc.).
 *
 * The format is defined at https://llmstxt.org/ — a single markdown file
 * served at `/llms.txt` with structure:
 *
 *   # <product name>
 *   > <one-paragraph description>
 *
 *   ## <section>
 *   - [<title>](<url>): <description>
 *
 * The agent can answer most questions from this file alone; the section
 * links let it deep-fetch when it needs the full prose.
 *
 * A longer companion file at `/llms-full.txt` (see ./llms-full.txt/route.ts)
 * inlines the full reference text — used when the agent decides to ingest
 * the canonical content rather than scrape it from HTML.
 */
import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

export async function GET() {
  const body = `# Renewal Radar

> Renewal Radar is SaaS renewal intelligence software for IT and Ops teams at 25–500-person companies. It tracks every SaaS subscription, sends escalating email alerts before each notice deadline, and drafts a vendor-ready cancellation letter when a customer decides to cancel. The customer always sends the letter themselves — Renewal Radar is an advisor, never an agent.

Renewal Radar does not pool, share, or sell customer contract data. It does not log into vendor portals on the customer's behalf. It does not auto-cancel or auto-renegotiate. Every action visible to a vendor is initiated by the customer from their own email client.

## Core capabilities

- [Dashboard](${APP_URL}/dashboard): At-a-glance view of saved-this-year, tracked subscriptions, annualized spend, and notice deadlines in the next 30 days.
- [Notice deadlines](${APP_URL}/notice-deadlines): The dates by which a customer must give written notice to avoid auto-renewal. Calculated as termEndDate − noticePeriodDays.
- [Action queue](${APP_URL}/action-queue): Renewals that need a decision soon, ranked by composite risk (urgency × annual value × auto-renew flag).
- [Review queue](${APP_URL}/review-queue): AI-extracted contract fields awaiting human approval. Nothing updates a subscription until the user accepts.
- [Contracts](${APP_URL}/documents): Upload PDF, DOCX, XLSX, CSV, plain text, markdown, or HTML. The local text extractor parses each; the heuristic AI extractor pulls renewal date, notice period, auto-renew status, contract value, price-increase clause, and cancellation method — each with a verbatim quote and page number for review.
- [Cancellation letter generator](${APP_URL}/dashboard): When the customer logs a "cancelled" decision, Renewal Radar drafts a vendor-ready letter. Two send paths: open in the user's mail client (mailto:) or copy to clipboard. Renewal Radar never sends the email.
- [Reports](${APP_URL}/reports): Year-to-date exposure, savings (cancelled + downgraded + renegotiated + avoided-increase), and missed deadlines.
- [Vendor intelligence](${APP_URL}/vendors): Per-vendor timeline of every subscription, decision, price change, owner change, and compliance artifact. Event-sourced and immutable.

## Pricing

- Free Forever: $0 — 5 subscriptions, 1 user, email alerts only.
- Starter: $79/month — 25 subscriptions, 3 users, email + in-app alerts, CSV import/export.
- Growth: $299/month — 100 subscriptions, 10 users, Slack, audit log, savings ledger.
- Pro: $899/month — 500 subscriptions, 25 users, AI contract extraction, approvals-lite, prep packs, vendor intelligence, 7-year audit retention.
- Enterprise: custom — SAML SSO, dedicated CSM, contracted SLA, 7-year audit archive.

All paid tiers include a 14-day trial. No credit card required to start. Annual billing preferred (monthly available at +20%).

## Architectural principles

- **Advisor, never agent.** Renewal Radar drafts vendor communications; the customer reviews and sends from their own email. There is no plan to ever cancel on a customer's behalf.
- **No data pooling.** Contract terms are never aggregated into a shared benchmarking dataset. The customer's data is theirs.
- **Tenant isolation.** Every database query is scoped by accountId. The isolation is enforced by application-level guards and exercised on every commit by a tenant-isolation test suite.
- **Encryption.** TLS 1.2+ in transit; AES-256 at rest. Integration secrets are wrapped with authenticated AES-256-GCM envelope encryption per account.
- **Audit log.** Every mutating administrative action is written to an audit log table. Retention is configurable per tier (30 days Free → 7 years Enterprise).
- **AI extraction is a draft, not legal advice.** Every extracted field carries a verbatim quote and page number. Nothing applies to a subscription until the user accepts.

## How notice deadlines work

A notice deadline is calculated as: \`termEndDate − noticePeriodDays\`. Example: a contract ending 2027-01-15 with a 60-day notice clause has a notice deadline of 2026-11-16. Renewal Radar sends email alerts at 30, 14, 7, 3, and 1 days before the deadline. The 7-day, 3-day, and 1-day alerts are non-mutable so the customer cannot accidentally silence the safety net.

## Competitors and positioning

Renewal Radar competes with Vendr, Tropic, Sastrify, and SpendHound. It is NOT an enterprise Contract Lifecycle Management (CLM) tool — it does not draft, redline, or negotiate contracts. It does not compete with Ironclad, ContractSafe, or Icertis. The wedge is contract-level notice deadlines, not shadow IT discovery (Nudge Security is a great free starting point if shadow IT is the primary pain).

## Resources

- [Home](${APP_URL}/): Marketing landing page with hero, how-it-works, features, pricing teaser, and FAQ.
- [Pricing](${APP_URL}/pricing): Public pricing across all five tiers + a feature matrix + value math.
- [Blog](${APP_URL}/blog): Definitional posts on SaaS notice deadlines, renewal architecture, and the principles behind the product. See ${APP_URL}/blog/rss.xml for the feed.
- [Security & privacy](${APP_URL}/security): Encryption, tenant isolation, subprocessors, retention, and incident response — documented in plain language.
- [Data Processing Addendum](${APP_URL}/legal/dpa): Standard DPA for Pro and Enterprise customers (GDPR / UK GDPR processor terms, SCCs, breach notification).
- [Privacy policy](${APP_URL}/privacy): Plain-language privacy policy.
- [Terms of service](${APP_URL}/terms): Plain-language terms of service.

## Contact

- Customer support: hello@renewalradar.com
- Security disclosure: security@renewalradar.com
- Privacy inquiries: privacy@renewalradar.com

Last updated: 2026-05-28.
`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
