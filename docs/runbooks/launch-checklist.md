# Launch Day Checklist

Print this. Tick boxes manually on launch day. Don't go live until every box that applies to you is checked.

Last reviewed: replace with your launch date.

---

## 1. Identity, legal, and compliance

- [ ] LLC / business entity registered with your state
- [ ] EIN obtained
- [ ] Business bank account opened
- [ ] Stripe Atlas (or equivalent) accepted, business verified
- [ ] Real Privacy Policy published at `/privacy` — review the placeholder content in `src/app/privacy/page.tsx` with counsel or Termly/Iubenda before going live
- [ ] Real Terms of Service published at `/terms` — same review process
- [ ] DPA template ready to send to Pro/Enterprise customers on request (Vanta, Termly, or counsel-drafted)
- [ ] Refund policy documented and consistent with what the billing flow actually does (prorated within 60 days, no refund after — matches Stripe Customer Portal cancellation behavior)
- [ ] Acceptable use policy documented (linked from Terms)
- [ ] Cookie banner decision made (Plausible doesn't need one; Stripe sets cookies — consult your jurisdiction)
- [ ] CCPA / state-specific privacy disclosures included if charging customers in California
- [ ] Domain WHOIS privacy enabled at your registrar

## 2. Stripe — flipping from test to live

- [ ] Stripe account fully verified for live mode (bank account, identity, business details)
- [ ] **Live mode** products created in Stripe Dashboard (same names/structure as test mode):
  - [ ] Renewal Radar Starter — recurring $948/year + optional $99/month
  - [ ] Renewal Radar Growth — recurring $3,588/year + optional $359/month
  - [ ] Renewal Radar Pro — recurring $10,788/year + optional $1,079/month
- [ ] Live-mode price IDs copied to **Vercel production env vars** (not just `.env.local`):
  - [ ] `STRIPE_SECRET_KEY` = `sk_live_...`
  - [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_live_...`
  - [ ] `STRIPE_STARTER_PRICE_ID` = live `price_...`
  - [ ] `STRIPE_GROWTH_PRICE_ID` = live `price_...`
  - [ ] `STRIPE_PRO_PRICE_ID` = live `price_...`
- [ ] Live-mode webhook endpoint created at `https://<your-domain>/api/webhooks/stripe`
- [ ] Webhook events subscribed: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `checkout.session.completed`
- [ ] Live-mode `STRIPE_WEBHOOK_SECRET` (separate from test mode) set in Vercel env
- [ ] Customer Portal enabled in Stripe Dashboard → Settings → Billing → Customer portal, with these features on:
  - [ ] Update payment methods
  - [ ] Update billing address
  - [ ] Cancel subscriptions
  - [ ] Switch plans (and all three products added to the allowed list)
  - [ ] View invoices
- [ ] Tax collection configured (Stripe Tax) if charging multi-state US
- [ ] Stripe Connect or Atlas business verification complete (required to receive payouts)
- [ ] Test the live-mode flow with your own real card and a $1 promotional price — verify webhook fires, `plan_tier` updates, then refund yourself and delete the test product

## 3. Authentication — Clerk live mode

- [ ] Clerk production instance created (separate from dev)
- [ ] Production publishable + secret keys in Vercel env
- [ ] Allowed redirect URLs include your production domain only (no localhost, no preview URLs unless intentional)
- [ ] Sign-in methods finalized (email/password required; Google optional)
- [ ] 2FA enabled and offered (not required) in Clerk config
- [ ] Session lifetime configured (default 7 days is reasonable)
- [ ] Production webhook endpoint: `https://<your-domain>/api/webhooks/clerk`
- [ ] Webhook subscribed to: `user.created`, `user.updated`, `user.deleted`
- [ ] `CLERK_WEBHOOK_SECRET` (production-specific) set in Vercel
- [ ] Email enumeration protection enabled

## 4. Email — Resend live setup

- [ ] Sending domain (`renewalradar.com`) added and verified in Resend
- [ ] DNS records for SPF, DKIM, DMARC added at your DNS provider (Cloudflare / Namecheap / etc.) per Resend's instructions
- [ ] `EMAIL_FROM` env var set to verified `notifications@<your-domain>`
- [ ] Production `RESEND_API_KEY` in Vercel env
- [ ] Send a test email to yourself across Gmail, Outlook, Apple Mail — confirm inbox delivery, not spam
- [ ] Run `mail-tester.com` against a test send — score 8+/10
- [ ] If new sending domain: spend 1 week sending low-volume before scaling (warmup)

## 5. Inngest — scheduled job sync

- [ ] Inngest production app created (separate from dev)
- [ ] Production app's `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env
- [ ] Inngest dashboard knows about your `/api/inngest` endpoint (it auto-syncs when called)
- [ ] Manually invoke `notice-deadline-alerts` once in production with no matching subscriptions — verify the run reports `sent: 0`, no errors
- [ ] Manually invoke `renewal-event-state-update` once — verify same
- [ ] Set up Inngest dashboard alerting: notify on function failure rate >5%

## 6. Database — Neon production

- [ ] Production Neon branch created (separate from `dev`)
- [ ] Pooled connection string copied to Vercel `DATABASE_URL` env
- [ ] `pnpm db:push` run against production (or proper `pnpm db:generate && pnpm db:migrate` workflow if you've started generating migrations)
- [ ] Confirm 6 tables, 7 enums, and indexes exist in production via Drizzle Studio or psql
- [ ] **Point-in-time recovery enabled** in Neon (Settings → branching). Default is 7 days; consider 30 for paid customers
- [ ] **Restore-test executed** — see `docs/DATA_RECOVERY.md`. Untested backups are not backups
- [ ] Connection limits sized appropriately (Neon Pro: 100 pooled connections is plenty for solo V1 scale)

## 7. Hosting — Vercel

- [ ] Project linked to GitHub repo, auto-deploys on `main`
- [ ] Production domain configured (`renewalradar.com`), DNS resolves, SSL valid
- [ ] `www` redirect to apex (or vice versa) configured
- [ ] All env vars present and matching the live-mode credentials above (NOT the dev ones)
- [ ] `NEXT_PUBLIC_APP_URL` set to `https://<your-production-domain>` (NOT `localhost`)
- [ ] Production build succeeds with no warnings in Vercel build logs
- [ ] Security headers verified in browser DevTools (HSTS, X-Frame-Options, etc. from `next.config.mjs`)
- [ ] Bundle size for the largest route is <500KB gzipped (check Vercel build output)

## 8. Error tracking — Sentry

- [ ] Production project created in Sentry
- [ ] `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` in Vercel env
- [ ] Source maps uploaded on deploy (handled automatically by `withSentryConfig` in `next.config.mjs`)
- [ ] Test error captured: visit a route that intentionally throws; confirm event appears in Sentry within 60 seconds
- [ ] Alerting configured: email or Slack on error rate spike (>5 errors in 5 minutes for the same fingerprint)

## 9. Uptime monitoring

- [ ] BetterUptime / Cronitor / UptimeRobot account created (free tier fine)
- [ ] Health check configured: `GET https://<your-domain>/api/health` every 1 minute
- [ ] Alert routes set: email + SMS to founder for any downtime >2 minutes
- [ ] Status page (optional but useful) — link in marketing site footer

## 10. Performance

- [ ] Lighthouse run against production: Performance ≥85, Accessibility ≥95, Best Practices ≥95, SEO ≥90
- [ ] Dashboard loads in <2s at 100 subscriptions (test with seed data on production)
- [ ] Notice deadline calendar loads in <2s
- [ ] No N+1 query patterns introduced (verify with Neon query insights)

## 11. Pre-launch dress rehearsal

Walk through the full customer journey on production with your own real email and a $1 test product (delete after):

- [ ] Sign up at `/sign-up` with a real email
- [ ] Receive welcome email within 60 seconds
- [ ] Land on empty dashboard with the 3-option onboarding card
- [ ] Coach mark sequence runs and dismisses correctly
- [ ] Add a subscription (Vendor / Product / cycle / dates / seats / price)
- [ ] Subscription appears on dashboard, in `/subscriptions`, in `/notice-deadlines` (if within 90 days), in `/renewals`
- [ ] Visit `/subscriptions/[id]/decide` for the renewal event
- [ ] Try each decision option; confirm Cancel reveals the **Cancellation Letter Draft Generator**
- [ ] Fill in your name + company in the letter; confirm subject + body update live
- [ ] Click "Copy to clipboard" → paste into a text editor → letter formatting clean
- [ ] Click "Open in my email client" → mailto opens correctly
- [ ] Log a non-cancel decision; verify it routes back and shows "Already decided"
- [ ] Visit `/settings/account` → edit account name → save → verify
- [ ] Visit `/settings/notifications` → toggle a non-locked preference → save → verify
- [ ] Visit `/settings/billing` → click Upgrade to Starter → complete real Stripe Checkout with $1 test product
- [ ] Within 30 seconds: webhook fires, `plan_tier` updates to `starter`, plan card in UI updates
- [ ] Click "Manage in Stripe" → Customer Portal opens → cancel subscription
- [ ] Within 30 seconds: `plan_tier` reverts to `free_forever`
- [ ] Verify `audit_log` table contains entries for every action above
- [ ] Verify `notification` table contains the welcome email row
- [ ] Sign out, sign back in, dashboard loads correctly

## 12. Soft launch — first 24 hours

- [ ] Stripe live mode active but ONLY share the URL with your 3-5 founding customers initially
- [ ] Founding customers' subscription data migrated from your manual concierge service into the real product (see `docs/FOUNDING_CUSTOMER_MIGRATION.md`)
- [ ] Each founding customer onboarded personally via 30-minute video call
- [ ] Open Sentry, Vercel logs, Stripe dashboard, and Inngest dashboard in browser tabs you check every hour
- [ ] Inbox cleared, ready to respond to any customer email within 2 hours
- [ ] Phone on, in case a founding customer hits a critical bug

## 13. Public launch — day 2+

- [ ] Marketing site live with sign-up CTAs pointing to production
- [ ] LinkedIn post written and scheduled
- [ ] Founder network outreach list ready (the prospects you've been talking to during validation)
- [ ] First 7 days: pace public sign-ups intentionally (max ~5/day) so you can support each one
- [ ] Daily for first 30 days: Sentry, Stripe MRR, new signups, customer emails — review each evening

## 14. If something goes catastrophically wrong

The "press the big red button" procedure:

1. **Disable new sign-ups** by adding a Clerk allowlist or setting `ALLOW_SIGNUPS=false` (requires a code-level flag you can add — V2 backlog)
2. **Pause Stripe webhook processing** by responding 5xx temporarily in the webhook route, or disabling the webhook in Stripe
3. **Email all affected customers** with honest status update — see template in `RUNBOOK.md`
4. **Restore from backup** if data corruption — see `docs/DATA_RECOVERY.md`
5. **Roll back** Vercel deploy via the Vercel dashboard if the issue is in the latest deploy

Don't make all these decisions alone if you can avoid it — have at least one trusted person (advisor, friend, fractional CTO) you can text at 2am.

---

## Sign-off

I, _______________, founder of Renewal Radar, have verified every applicable item on this checklist on _______________ (date).

I understand that launching a SaaS product means I am responsible for customer data, billing accuracy, security, and uptime. I am not delegating these responsibilities to any tool or vendor.

Signature: _______________
