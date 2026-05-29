# Renewal Radar — User Manual

Welcome. This guide walks a new user through everything Renewal Radar does, in the order you'll actually use it. It's written for the person who owns SaaS renewals — an IT, Ops, Finance, or Procurement lead — not for engineers.

> **The promise:** stop hand-maintaining a subscription spreadsheet, stop missing auto-renewal deadlines, and walk into every renewal with an evidence-backed recommendation.
>
> **What we never do:** email your vendors, move money, or sell your data. Renewal Radar is an *advisor* — it drafts and recommends; **you** send every external message.

---

## Contents

1. [Signing in](#1-signing-in)
2. [Your first 15 minutes](#2-your-first-15-minutes)
3. [Building your inventory](#3-building-your-inventory)
4. [The spend feed — let the inventory build itself](#4-the-spend-feed)
5. [Never miss a deadline](#5-never-miss-a-deadline)
6. [The Renewal Intelligence Brief](#6-the-renewal-intelligence-brief)
7. [Drafting the internal notice (safe-agent)](#7-drafting-the-internal-notice)
8. [Deciding a renewal](#8-deciding-a-renewal)
9. [Proving savings — the ROI loop](#9-proving-savings)
10. [Vendor intelligence & benchmarks](#10-vendor-intelligence--benchmarks)
11. [Procurement intake & approvals](#11-procurement-intake--approvals)
12. [Reports & exports](#12-reports--exports)
13. [Team, roles & settings](#13-team-roles--settings)
14. [Plans & what's included](#14-plans--whats-included)
15. [The vendor portal (for vendors)](#15-the-vendor-portal)
16. [FAQ](#16-faq)

---

## 1. Signing in

Renewal Radar uses email-based sign-in (SSO/passwordless). Your administrator invites you; you accept the invite and land on the **Dashboard**.

Roles you may have:
- **Owner / Admin** — full access, can approve decisions and manage the team.
- **Member** — can add subscriptions, run briefs, draft notices, log decisions.
- **Viewer** — read-only.

---

## 2. Your first 15 minutes

The Dashboard greets first-run accounts with a **four-tile fork** — pick whichever matches the data you have:

| If you have… | Do this |
|---|---|
| A contract PDF | **Upload a contract** → AI extracts dates, price, and the notice clause for you to confirm |
| A spreadsheet of tools | **Paste from spreadsheet** (TSV) or **Import CSV** |
| A card/expense feed | **Connect the spend feed** → subscriptions are auto-detected |
| Nothing yet | **Start from a starter template** for your industry, then edit |

You don't have to choose one — most teams seed with a CSV or the spend feed, then upload contracts as renewals approach.

---

## 3. Building your inventory

**Subscriptions** is your master list of everything you pay for. Each subscription holds the vendor, product, billing cycle, seats, cost, term dates, auto-renew flag, notice period, and owner.

Ways to add them:
- **Add manually** — the form with vendor autocomplete.
- **Quick-add draft** — capture just vendor + estimated cost now; fill in term details later. Drafts don't fire alerts and don't pollute reports until you promote them.
- **CSV import** — upload a CSV; you get a **diff preview** (what's new vs. a duplicate) before anything is written, plus a **24-hour undo**. Multi-language column headers are recognized.
- **Paste-from-spreadsheet** — paste TSV rows straight from Excel/Sheets.
- **Contract upload** — drop one or many PDFs/DOCX/XLSX. Renewal Radar extracts key fields with AI and queues them in the **Review queue**, where you accept/edit/reject each field (with the source quote shown). Nothing touches a subscription until you accept it.
- **Starter templates** — pre-filled common-stack rows to edit down.

---

## 4. The spend feed

*Auto-discovery — "you stop being the data pipe."*

**Spend feed** (left nav) connects a card/expense source and continuously detects recurring charges, so your inventory keeps populating itself.

How it works:
1. **Connect** the feed (one click). Renewal Radar ingests your charge lines.
2. The detector finds **recurring** charges — classifying cadence (monthly/quarterly/annual), spotting **price increases**, netting refunds, and ignoring one-offs and coffee. Each suggestion shows a **confidence score** and any price drift (e.g. `+15% PRICE`).
3. You **review**: for each detected subscription, **Add as subscription** (creates it), **Confirm match** (links it to one you already track), or **Not a subscription** (dismiss).

Renewal Radar **never adds anything without your confirmation.** A daily background sync keeps the feed current. Confirmed charges also feed the Renewal Intelligence Brief (below) with real price history.

> Spend auto-discovery is a paid feature (Starter and up). On the free plan you'll see an upgrade prompt instead of the feed.

---

## 5. Never miss a deadline

- **Notice deadlines** (left nav) lists every upcoming window to opt out before an auto-renewal locks you in for another term.
- **Action queue** ranks what needs attention by urgency and a computed **risk score**.
- **Alerts**: escalating email reminders (and Slack, if connected) as a deadline approaches.
- **Renewals**: a 12-month calendar view. Export it to your calendar app via **ICS**.

---

## 6. The Renewal Intelligence Brief

On any subscription's detail page, click **Generate brief**. Renewal Radar produces an evidence-backed recommendation by *reasoning over several signals at once*:

- **Price trajectory** — regressed over the subscription's own charge history (including the real charges from your connected spend feed), with a projected next-renewal range.
- **Benchmark** — how your price/terms compare to the anonymized cross-account median.
- **Renewal risk / urgency** — days to the notice deadline and whether auto-renew is on.
- **Negotiation leverage** and **your walk-away (BATNA)**.
- **A recommendation** — one of *renew / renew-with-adjustments / downgrade / cancel / defer*.

Every claim is **expandable to its evidence** ("show me the receipts") and is **labeled with the engine that produced it** (`deterministic` or, once enabled, `Claude`). Claims without evidence are dropped — the brief never asserts something it can't back up. It's a recommendation, not legal advice.

Brief generation is rate-limited and is a paid feature (Starter and up).

---

## 7. Drafting the internal notice

Right below the brief is **Internal renewal notice**. Click **Draft internal notice** and Renewal Radar composes an **internal memo** for your renewal owner / procurement team — the recommendation, the hard notice deadline, key facts, and the supporting points.

- It's **editable** (subject + body), with **Copy** and **Download .txt**.
- It is **never addressed to the vendor.** The memo literally says so. This is the safe-agent line: Renewal Radar prepares the internal note; **a human** owns any outbound contact with the vendor.

When you're ready to actually contact the vendor (to cancel or renegotiate), use the cancellation-letter draft in Decide Now (next section) — which you also send yourself.

---

## 8. Deciding a renewal

From the action queue or a subscription, open **Decide Now**:
- Record the decision (renew / renegotiate / downgrade / cancel) with a rationale and the negotiation lever you used.
- If cancelling, generate a **cancellation letter** addressed to the vendor — pre-filled, ready for you to review and send from *your* email client.
- Decisions feed your savings ledger and the per-vendor timeline.

Higher tiers add **Approvals-lite**: a recorded decision can require a second person's approval before it's final (the approver can't be the same person who recorded it).

---

## 9. Proving savings

Every decision that saves money creates a **savings record** (projected savings). Renewal Radar then **closes the loop**:

- A daily job reconciles each projected saving against your **actual post-renewal spend** from the connected feed.
- On **Reports**, the **Realized vs projected savings** card shows **projected** dollars next to **proven** (reconciled) dollars, with counts of how many matched the projection, how many varied, and how many are still awaiting their first post-renewal charge.

This is the difference between "we think we saved $X" and "we *proved* we saved $X."

---

## 10. Vendor intelligence & benchmarks

- **Vendors** → a vendor's page shows a full **timeline** (price changes, decisions, briefs, savings realized, compliance docs) and the **cross-account benchmark** — how your terms compare to the anonymized median across all Renewal Radar accounts.
- **Playbooks** captures what worked, as reusable negotiation plays.
- The benchmark is always anonymized aggregate data — never another company's raw details.

---

## 11. Procurement intake & approvals

- **Requests** is an internal intake form: anyone on the team can request "we want to start paying for X." Owners/admins see a badge and can approve (which creates a draft subscription) or decline.
- **Approvals** holds renewal decisions awaiting a second pair of eyes.

---

## 12. Reports & exports

**Reports** gives a year-to-date view: annualized exposure by renewal status, the savings ledger (with realized-vs-projected), and missed-deadline history. Exports:
- **CSV** of exposure, savings, and subscriptions.
- **Renewal Prep Pack PDF** per subscription (everything you need to walk into a negotiation).
- **ICS** calendar feed of renewal/notice dates.
- **GDPR-style data export** of your account's data (Settings).

---

## 13. Team, roles & settings

**Settings**:
- **Team** — invite teammates, set roles (owner/admin/member/viewer), manage seats.
- **Notifications** — choose channels (in-app, email, Slack) per event type.
- **Billing** — plan, usage, upgrade/downgrade (Stripe).
- **Integrations** — Slack webhook, spend feed, API keys.
- **Audit log** — every change, who made it, when.

If a plan downgrade leaves you over a new cap, the account becomes read-only for *new* writes (your data stays fully visible) until you upgrade or trim — you never lose anything.

---

## 14. Plans & what's included

| Capability | Free | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|---|
| Subscriptions tracked | 5 | 50 | 200 | 500 | Unlimited |
| Notice alerts, calendar, cancellation letters | ✓ | ✓ | ✓ | ✓ | ✓ |
| AI contract extraction | 5 pg/mo | 200 | 1,000 | 5,000 | Unlimited |
| **Spend auto-discovery feed** | — | ✓ | ✓ | ✓ | ✓ |
| **Renewal Intelligence Brief** | — | ✓ | ✓ | ✓ | ✓ |
| Internal notice draft | — | ✓ | ✓ | ✓ | ✓ |
| CSV import/export, Prep Pack, Monthly PDF | — | ✓ | ✓ | ✓ | ✓ |
| Savings tracker + realized-vs-projected | — | — | ✓ | ✓ | ✓ |
| Slack alerts, Approvals-lite | — | — | ✓ | ✓ | ✓ |
| Custom DPA | — | — | — | ✓ | ✓ |
| SAML SSO | — | — | — | — | ✓ |

Caps count drafts as well as active subscriptions, so the limit can't be bypassed by parking everything in draft.

---

## 15. The vendor portal

Vendors have their *own* sign-in (separate from your team). A verified vendor can publish price-change and renewal announcements that land in your **Vendor updates** inbox. This is opt-in on both sides and never lets a vendor see your internal data — it's a notification channel, not access to your account.

---

## 16. FAQ

**Does Renewal Radar contact my vendors?**
No. It drafts letters and internal memos; you send everything. This is a binding product principle.

**Does it connect to my bank or pay invoices?**
No. The spend feed is *read-only* ingestion of charge lines for detection. There are no payment rails.

**Is the "AI" real or just templates?**
The Renewal Intelligence Brief genuinely composes multiple signals (price regression, benchmark percentile, urgency, leverage, BATNA) into one recommendation — reasoning a spreadsheet cell can't do — and shows its evidence per claim. Each claim is labeled with the engine that produced it; nothing unsupported is asserted.

**What happens to my data if I cancel or downgrade?**
Reads keep working so you can export. We never hard-delete users, and a GDPR-style export is available in Settings.

**Will my data be pooled with other companies'?**
Only as **anonymized aggregates** powering the benchmark (e.g. "median price for this vendor"). Never your raw, identifiable data.

**Can I try it without setting anything up?**
Yes — a demo build runs with seeded data and auth bypassed for evaluation. Ask your administrator, or run it locally with `DEMO_MODE=true` (see the README).
