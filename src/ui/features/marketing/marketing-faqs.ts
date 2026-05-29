/**
 * FAQ content — single source of truth.
 *
 * Used by:
 *   - the visible `<FAQ />` section on the marketing home
 *   - the `FaqPageJsonLd` block in the home `<head>` (so Google sees
 *     identical Q/A text to what the user reads)
 *   - the pricing page FAQ + its FaqPageJsonLd
 *   - the security page FAQ (planned)
 *
 * Keeping the questions in one place is what makes FAQ-rich-results pass
 * Google's "the JSON-LD must match the on-page content" check.
 */
export const HOME_FAQ = [
  {
    question: "Is the Free Forever plan actually free? What's the catch?",
    answer:
      "Yes — really free. Up to 5 subscriptions tracked, single user, email alerts on notice deadlines. The cap nudges teams who get serious about the product to upgrade to Starter, but there is no time limit and no credit card is required to use it forever.",
  },
  {
    question: "How is Renewal Radar different from SpendHound or Vendr?",
    answer:
      "SpendHound is free because customers contribute their contract terms to a shared benchmark dataset. Vendr operates negotiation services. Renewal Radar does neither. We are paid software that watches notice deadlines and drafts cancellation letters — the customer stays in control of every external communication.",
  },
  {
    question: "Do I need to set up any integrations to use Renewal Radar?",
    answer:
      "No. Renewal Radar works from manual entry alone. You add subscriptions by typing in the vendor, product, term, and price. CSV import and contract uploads are available; vendor APIs land in V2. Day one works without anything connected.",
  },
  {
    question: "What about employees buying SaaS on personal cards (shadow IT)?",
    answer:
      "V1 does not catch shadow IT. We are honest about that — the wedge is contract-level notice deadlines, not credit card monitoring. If shadow IT discovery is your primary pain, Nudge Security is a great free starting point.",
  },
  {
    question: "Can I cancel my Renewal Radar subscription any time?",
    answer:
      "Yes, one click in your Stripe customer portal. We give a prorated refund within 60 days of your most recent payment. No retention pitches, no friction. The whole point is that you stay because the product works, not because cancellation is hard.",
  },
  {
    question: "Do you actually cancel my vendor subscriptions for me?",
    answer:
      "No, and we never will. Renewal Radar drafts a vendor-ready cancellation letter and pre-populates your email client. You review and click send. This is a binding architectural principle — the product is an advisor, never an agent.",
  },
] as const;

export const PRICING_FAQ = [
  {
    question: "Do you offer a free trial?",
    answer:
      "Free Forever is unlimited in time but capped at 5 subscriptions. Paid tiers (Starter, Growth, Pro) include a 14-day trial — full features, no credit card required to start.",
  },
  {
    question: "Can I switch tiers later?",
    answer:
      "Yes, any time. Upgrades are immediate and prorated. Downgrades take effect at the end of your current billing period. All managed in the Stripe customer portal — one click.",
  },
  {
    question: "What if I cancel mid-term?",
    answer:
      "Cancel any time. Prorated refund within 60 days of your most recent payment. After 60 days, access continues through the end of the paid period — no refund.",
  },
  {
    question: "What happens if my payment fails?",
    answer:
      "Stripe runs standard dunning (3 retries over ~21 days) and sends you reminders. Your account stays in 'past due' grace during this window. After 21 days of failed attempts, you revert to Free Forever and the data is preserved.",
  },
  {
    question: "Do you charge per user or per subscription tracked?",
    answer:
      "Per account, with both user and subscription caps per tier. Most teams hit the subscription cap before the user cap — it is the more binding limit.",
  },
  {
    question: "Are taxes included in the price?",
    answer:
      "No — Stripe collects sales tax where required by your jurisdiction. Tax is shown on the checkout page before you confirm the purchase.",
  },
] as const;
