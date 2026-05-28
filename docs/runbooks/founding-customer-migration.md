# Founding Customer Migration

How to move your founding customers from your manual concierge service (`v3/validation/04_Founding_Customer_Offer.md`) into the real product on launch day.

## Why this needs a doc

Founding customers are your most valuable cohort. They paid before the product existed. Their migration is the moment Renewal Radar stops being a service-delivered Google Sheet and becomes software. A botched migration here means churned customers and a credibility hit you can't easily recover from.

This document is the playbook.

## What you should have for each founding customer

Per founding customer you should already have (from the concierge phase):

- A signed Founding Customer Agreement (`v3/validation/04_Founding_Customer_Offer.md` template)
- A dedicated Google Drive folder with their contracts and subscription tracking sheet
- Their email + name + company
- Their Stripe customer record (they're paying $99/month already)
- 1-3 cancellation letters you've drafted for them as evidence of value

## Migration timeline

Schedule each founding customer's migration as a 30-minute video call within the first 2 weeks of public launch. Don't do them all in one day — you'll burn out and rush.

Suggested cadence:

- **Day -7 (week before launch):** Email all founding customers: "V1 ships [date]. I'll book a 30-min call with each of you in the first 2 weeks to migrate your data. Here's the Calendly link."
- **Day 0-3:** First two founding customers migrate. You learn what's hard, refine the procedure.
- **Day 4-14:** Remaining founding customers migrate, one or two per day.

## Per-customer migration procedure (30 min call)

### Pre-call (10 min, before the call)

1. Sign in to **their** account using Clerk's "Sign in as user" (V2 feature — for V1 you'll need them on the call to do this with screen-share)
   - Alternative: have them sign up on launch day with the same email you used for the Founding Customer Agreement
2. From their Google Sheet, copy their subscription inventory into a CSV in this format:

```csv
vendor_name,product_name,plan_name,billing_cycle,term_start_date,term_end_date,total_seats,unit_price_dollars,notice_period_days,auto_renew,notes
Atlassian,Jira Software,Standard,annual,2025-07-14,2026-07-14,50,12,30,true,
Datadog,Pro Plan,Pro,annual,2025-04-21,2026-04-21,10,70,30,true,
```

CSV import isn't in V1 (it's V1.5). For now, you'll enter each subscription manually on the call. Plan for 90 seconds per subscription. 10 subscriptions = 15 minutes.

### On the call (30 min)

1. **Greet (2 min):** "Today we move you from our Google Sheet to the real product. Same coverage, same price, locked rate continues for 24 months."

2. **Have them sign in (3 min):** They click your Calendly confirmation email's sign-up link, or visit `<your-domain>/sign-up` directly. Use the email on their Founding Customer Agreement.

3. **Walk through the empty dashboard (2 min):** Briefly explain the action band, KPI strip, side nav.

4. **Manually enter their subscriptions (15 min):** Screen-share from their side. You read each row from their CSV; they type it in. After 3-4 rows they'll get the rhythm and you switch to them doing it.

5. **Show their populated dashboard (3 min):** Now there's real data. Walk through:
   - The first notice deadline in their spotlight
   - One subscription detail page
   - The Decide Now workflow on a real renewal event (don't actually submit)
   - The cancellation letter generator (they can see their name auto-populated)

6. **Upgrade them to a paid Stripe subscription (3 min):**
   - Visit `/settings/billing` → click Upgrade on Starter
   - Stripe Checkout opens
   - **Important:** Use a Stripe coupon to apply their Founding Customer rate ($99/mo locked) instead of the standard price
   - Create the coupon ahead of time in Stripe: 18% off Starter ($99 → $79 makes the math wrong; better: create a custom price)
   - **Best path:** Create one-off prices in Stripe ahead of time for each founding customer at $99/month, and direct them to checkout with that price ID rather than the standard Starter price. Track this in a "Founding Customers" spreadsheet.

7. **Walk through notification preferences (2 min):** "These three alerts (7/3/1-day) are locked on. The 30 and 14-day ones you can adjust. The weekly digest defaults on."

8. **Cancel their old concierge billing (1 min, after the call):** In your Stripe dashboard, cancel the existing $99/month concierge subscription. Their new Stripe subscription replaces it. Send a follow-up email confirming.

9. **Schedule their first 30-day check-in (1 min):** "Let's chat in 30 days to see how it's going."

### Post-call (15 min, same day)

1. **Send a follow-up email:**

```
Subject: Welcome to Renewal Radar (the real version)

Hi [First name],

You're officially migrated. A few things:

1. Your Founding Customer rate ($99/mo) is locked for 24 months from today.
2. Your old concierge billing has been cancelled. You'll see one charge from
   the new billing line on [date].
3. Your subscription data is now in the product at <your-domain>. I'll
   continue to be available by email for anything that comes up.
4. Quarterly review call: I'll send a Calendly invite for 90 days from today.

Anything that came up during our call I'll follow up on this week.

Thanks for trusting us. You're customer #N of our first 10.

[Your name]
```

2. **Archive their concierge Google Drive folder** to a "Concierge Phase — archived" parent folder. Don't delete — you may need to reference it.

3. **Update your Founding Customers spreadsheet:**
   - Migration date
   - Issues encountered
   - Any follow-up items
   - Their new Stripe subscription ID

## Edge cases

### "I want to wait — keep the manual service for now"

Some founding customers will resist migration. Fine — keep delivering manually for them for 30 more days while you focus on others. Set a calendar reminder for the deadline. Beyond 60 days post-launch, the manual delivery model needs to wind down for everyone (it doesn't scale).

### "The product's missing X feature my manual service had"

Some founding customers got bespoke service items that V1 doesn't fully replicate (e.g., custom cancellation letters in your house style, ad-hoc Loom videos walking through their stack). Two options:

1. **Continue delivering those manually on the side** for the 24-month locked period. You owe them something for being first.
2. **Add them to the V1.5 backlog if multiple customers want them.** Otherwise treat as a non-product perk.

### "Their data is messier than the form supports"

V1's subscription form requires structured input. Some customers' historical data may have weird billing arrangements (multiple add-ons rolled into one annual fee, etc.). Just enter the simplification, note the discrepancy in the `notes` field, and tell them "we'll model this more cleanly in V1.5."

### "They want to import their contracts as PDFs"

V1 has no contract upload (V1.5). Workaround: keep the PDFs in your shared Google Drive folder for now. The notice deadline information they captured in your Google Sheet is the operational data; the PDF is just the legal source.

### "They're at 6+ subscriptions on the Free Forever tier they upgraded from"

Shouldn't happen — founding customers were on the paid concierge plan, not Free Forever. If somehow they tried the Free Forever signup first: their account exists at 5-subscription cap; complete the upgrade to Starter in step 6 before adding more.

## Stripe pricing — the Founding Customer rate

If you committed to $99/mo locked for 24 months, but your standard Starter price is $99/mo monthly OR $79/mo annual ($948/year), you need a Stripe configuration that matches the agreement.

Simplest approach: create a separate Stripe Product called "Founding Customer Plan" with a single price of $99/month, then issue a per-customer checkout link.

In your Stripe Dashboard (live mode):

1. Products → New → name: "Founding Customer Plan"
2. Recurring price: $99/month, billed monthly
3. Note the price ID (`price_...`)
4. Add to your founding customers spreadsheet
5. In code: don't expose this product in the standard `/settings/billing` page. Direct founding customers to a custom Checkout via a personal link you send them.

For the personal Checkout link, use Stripe's "Payment Link" feature (Stripe Dashboard → Payment links):

1. Create payment link tied to the Founding Customer Plan price
2. Customize success URL to `https://<your-domain>/settings/billing?upgrade=success`
3. Share this link with each founding customer in their welcome email

When the webhook fires for these customers, `planTierForPriceId` in `src/lib/billing/plans.ts` won't recognize the price ID. Add it to the map:

```typescript
// src/lib/billing/plans.ts
const PRICE_TO_TIER: Partial<Record<string, PlanTier>> = {
  [process.env.STRIPE_STARTER_PRICE_ID ?? "starter-placeholder"]: "starter",
  [process.env.STRIPE_GROWTH_PRICE_ID ?? "growth-placeholder"]: "growth",
  [process.env.STRIPE_PRO_PRICE_ID ?? "pro-placeholder"]: "pro",
  // Founding customer plan — maps to starter tier features
  [process.env.STRIPE_FOUNDING_PRICE_ID ?? "founding-placeholder"]: "starter",
};
```

Add `STRIPE_FOUNDING_PRICE_ID` to your Vercel env vars.

## 24-month renewal handling

The Founding Customer Agreement says the $99 rate is locked for 24 months from V1 launch. After 24 months they roll to standard pricing.

Set a calendar reminder for 60 days before the 24-month anniversary:

- Email each founding customer: "Your founding rate ends [date]. Standard Starter pricing applies after that — $79/mo annual or $99/mo monthly."
- Give them a path to renew at standard rates without service interruption

Don't auto-bump them without notice. Founding customers are your best referral source — treat them right.

## Migration completion checklist

For each founding customer:

- [ ] Migration call completed (date: _____)
- [ ] All historical subscriptions entered in the product
- [ ] Notification preferences set
- [ ] Stripe subscription active at Founding Customer rate ($99/mo)
- [ ] Old concierge Stripe subscription cancelled
- [ ] Welcome-to-the-real-product email sent
- [ ] Quarterly review call scheduled (90 days out)
- [ ] Founding Customers spreadsheet updated

Once all 5-10 founding customers are migrated, the concierge service phase is officially complete. Add a "DON'T MANUALLY DELIVER" sticky note to your monitor for at least 30 days so you don't accidentally regress.
