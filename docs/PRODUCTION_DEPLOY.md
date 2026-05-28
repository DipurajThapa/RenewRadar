# Production Deployment Guide

Step-by-step for the first deploy to production. After the first deploy, subsequent deploys happen automatically via Vercel's GitHub integration when you push to `main`.

Estimated time: 90 minutes if you have all accounts set up, 3-4 hours if starting from zero.

## Prerequisites

- [ ] GitHub repo exists with code on `main` branch
- [ ] Vercel account (free Hobby tier OK for launch; upgrade to Pro at first paying customer)
- [ ] Neon Postgres account
- [ ] Clerk account (production instance, separate from dev)
- [ ] Stripe account (live mode activated — requires bank account + business verification)
- [ ] Resend account with domain verified
- [ ] Inngest account
- [ ] Sentry account
- [ ] Domain registered (Cloudflare, Namecheap, or similar)

## Step 1 — Set up Neon production branch (10 min)

1. Open neon.tech → your project → Branches
2. Create a new branch from `main` named `production` (or use the default `main` if you haven't used it for dev)
3. From the production branch's Connection Details, copy the **Pooled connection** string — it'll contain `-pooler` in the hostname
4. Save it; you'll paste it into Vercel in Step 6

## Step 2 — Push schema to production database (5 min)

```bash
# Locally, with production DATABASE_URL temporarily set:
DATABASE_URL="<your-production-pooled-url>" pnpm db:push
```

Verify in Neon's table view that all 6 tables and 7 enums exist.

**Do not run the seed script against production.** It deletes all data.

Enable point-in-time recovery in Neon → Settings → Branches → set retention to 7 days minimum (30 for paid accounts).

## Step 3 — Set up Clerk production instance (15 min)

1. clerk.com → Switch from "Development" to "Production" environment (top-right toggle)
2. Create a new application named "Renewal Radar Production" (separate from dev)
3. Customize the appearance to match your marketing brand
4. Configure sign-in methods (email/password required; Google optional)
5. Set session lifetime (7 days reasonable)
6. Add allowed redirect URLs:
   - `https://<your-production-domain>/dashboard`
   - `https://<your-production-domain>/*` (or specific routes)
7. Note: webhook setup happens later, after Vercel deploy gives us a URL

Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_...`) and `CLERK_SECRET_KEY` (`sk_live_...`) — paste into Vercel in Step 6.

## Step 4 — Set up Stripe live mode (20 min)

1. stripe.com → switch to **Live mode** (top-right toggle)
2. Complete business verification if not done (bank account, identity, tax info)
3. Create three products:
   - **Renewal Radar Starter** → recurring annual at $948 (and optionally monthly at $99)
   - **Renewal Radar Growth** → recurring annual at $3,588 (+ optional monthly at $359)
   - **Renewal Radar Pro** → recurring annual at $10,788 (+ optional monthly at $1,079)
4. Copy each annual price ID (`price_...`) — paste into Vercel in Step 6
5. Settings → Billing → Customer portal: enable plan switches, payment method updates, billing address, cancellation, invoices. Add all three products to allowed switches.
6. Webhook setup happens later, after Vercel deploy gives us a URL

Get your live `sk_live_...` and `pk_live_...` keys — paste into Vercel in Step 6.

## Step 5 — Set up other services

**Resend (10 min):**

1. resend.com → API Keys → create a production-scoped key
2. Add your sending domain (`renewalradar.com`)
3. Copy the DNS records Resend shows you (SPF, DKIM, DMARC) and add them at your DNS provider
4. Verify the domain — usually takes 5-15 minutes for DNS to propagate
5. Note `RESEND_API_KEY` and decide `EMAIL_FROM` (e.g. `Renewal Radar <notifications@renewalradar.com>`)

**Inngest (5 min):**

1. inngest.com → create production app named `renewal-radar`
2. Settings → copy `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` (the production-scoped ones)
3. Sync endpoint setup happens after Vercel deploy

**Sentry (10 min):**

1. sentry.io → create a new project named `renewal-radar` with platform "Next.js"
2. Copy the DSN (`https://...@sentry.io/...`)
3. Create an internal integration / auth token for source map uploads:
   - Settings → Developer Settings → Custom Integrations → New
   - Permissions: Project: Read & Write, Release: Admin
   - Copy the token
4. Note `SENTRY_DSN`, `SENTRY_ORG` (your slug), `SENTRY_PROJECT` (`renewal-radar`), `SENTRY_AUTH_TOKEN`

## Step 6 — Vercel project setup (15 min)

1. vercel.com → Add New Project → import your GitHub repo
2. Framework: Next.js (auto-detected)
3. Build settings: keep defaults
4. **Add all production env vars** (this is the critical step):

```
NEXT_PUBLIC_APP_URL=https://<your-production-domain>
EMAIL_FROM=Renewal Radar <notifications@renewalradar.com>

DATABASE_URL=postgres://...-pooler.../...?sslmode=require

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
CLERK_WEBHOOK_SECRET=<set-after-step-7>

STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_STARTER_PRICE_ID=price_live_...
STRIPE_GROWTH_PRICE_ID=price_live_...
STRIPE_PRO_PRICE_ID=price_live_...
STRIPE_WEBHOOK_SECRET=<set-after-step-8>

RESEND_API_KEY=re_live_...

INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=signkey-prod-...

SENTRY_DSN=https://...@sentry.io/...
SENTRY_ORG=<your-org>
SENTRY_PROJECT=renewal-radar
SENTRY_AUTH_TOKEN=...
```

5. Click Deploy. Build runs (~2 minutes).
6. After deploy succeeds, copy the production URL (something like `renewal-radar.vercel.app` initially).

## Step 7 — Configure Clerk webhook (5 min)

Now that you have a production URL:

1. Clerk Dashboard → your production app → Webhooks → Add Endpoint
2. URL: `https://<your-production-domain>/api/webhooks/clerk`
3. Events: `user.created`, `user.updated`, `user.deleted`
4. Save → copy the signing secret (`whsec_...`)
5. Vercel → Settings → Environment Variables → set `CLERK_WEBHOOK_SECRET` = the secret
6. Vercel will auto-redeploy on env change. Wait ~30 seconds.

## Step 8 — Configure Stripe webhook (5 min)

1. Stripe Dashboard (live mode) → Developers → Webhooks → Add endpoint
2. URL: `https://<your-production-domain>/api/webhooks/stripe`
3. Events to subscribe:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `checkout.session.completed`
4. Save → copy the signing secret (`whsec_...`)
5. Vercel → set `STRIPE_WEBHOOK_SECRET` = the secret
6. Wait for redeploy

## Step 9 — Configure custom domain (10 min)

1. Vercel → Project → Settings → Domains → Add Domain → enter your domain
2. Vercel shows DNS records you need to add at your registrar
3. Add the records (usually a CNAME for www and an A or CNAME for apex)
4. Wait for DNS to propagate (5-30 minutes)
5. Vercel auto-issues SSL within minutes once DNS resolves
6. Update `NEXT_PUBLIC_APP_URL` in Vercel env to use the custom domain
7. Update Clerk webhook URL to use the custom domain (if you used the Vercel URL earlier)
8. Update Stripe webhook URL to use the custom domain (same)

## Step 10 — Sync Inngest to production (5 min)

1. Visit `https://<your-production-domain>/api/inngest` in a browser. You should see a JSON response listing the registered functions.
2. Inngest Dashboard → your production app → Settings → Functions → Sync URL → enter `https://<your-production-domain>/api/inngest` → Sync
3. Both `notice-deadline-alerts` and `renewal-event-state-update` should appear as registered

## Step 11 — Smoke test production (15 min)

Walk through the dress rehearsal from `LAUNCH_CHECKLIST.md` Section 11. Don't skip any step.

If anything fails, do not launch publicly. Diagnose, fix, re-deploy, re-test.

## Step 12 — Health check + uptime monitoring (5 min)

1. Visit `https://<your-production-domain>/api/health` → confirm `{"ok":true,"ts":"..."}`
2. BetterUptime / Cronitor / UptimeRobot: add a monitor for that URL, 1-minute interval
3. Configure alerts: email + SMS to your phone for any downtime ≥2 minutes

## Step 13 — You're live

Push the marketing URL only to founding customers initially. See `LAUNCH_CHECKLIST.md` Section 12 for the soft-launch protocol.

---

## Subsequent deploys

After this first deploy, all you need to do for new code:

```bash
git push origin main
```

Vercel auto-deploys. Build takes ~2 minutes. You watch the build log if you want; otherwise an alert hits Sentry if anything errors at runtime.

Schema changes:

```bash
# Generate migration locally
pnpm db:generate

# Commit migration files in drizzle/ to git
git add drizzle/
git commit -m "Schema: add X table"

# After deploy, apply the migration against production:
DATABASE_URL="<prod-url>" pnpm db:migrate
```

Don't `pnpm db:push` against production after the first deploy — use `db:generate` + `db:migrate` so you have a paper trail of every schema change.
