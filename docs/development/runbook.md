# Operations Runbook

How to run Renewal Radar in production. This is the document you reach for at 2am when something is on fire.

## Quick links

- **Production app:** `https://<your-domain>`
- **Vercel dashboard:** project `renewal-radar`
- **Neon database:** `renewal-radar-prod` project
- **Clerk dashboard:** production instance
- **Stripe dashboard:** **live mode**
- **Inngest dashboard:** production app
- **Sentry dashboard:** production project
- **Status page (if any):** `https://status.<your-domain>`

Bookmark all of these in a single browser folder named "Renewal Radar Production." Check the first four every weekday morning.

## Architecture in one paragraph

Next.js 14 App Router deployed to Vercel. Postgres on Neon. Authentication via Clerk (webhook-based user provisioning). Billing via Stripe (Checkout + Customer Portal + webhooks). Transactional email via Resend. Scheduled jobs (daily notice-deadline alerts, daily renewal-event state machine) via Inngest. Error tracking via Sentry. Health endpoint at `/api/health`. Webhook endpoints at `/api/webhooks/clerk` and `/api/webhooks/stripe`. Inngest sync endpoint at `/api/inngest`.

## Daily operating cadence

Morning (10 min):

1. Open Sentry → check for new error fingerprints in the last 24 hours
2. Open Vercel → check deploys, function invocations, any 5xx spikes
3. Open Stripe → check MRR, new customers, any failed payments
4. Open Inngest → confirm yesterday's `notice-deadline-alerts` ran with `failed: 0`
5. Email inbox → respond to anything from customers within 4 hours

Weekly (30 min, Friday afternoon):

1. Review `audit_log` table for unusual patterns
2. Database query insights (Neon) — any slow queries trending up
3. Plausible analytics → conversion funnel from signup to first subscription added
4. Stripe → churn this week; any payment failures unresolved
5. Customer interviews — at least 1 per week even after launch

## Common issues and fixes

### "A customer signed up but their account didn't appear in the database"

The Clerk webhook didn't fire or failed. Diagnosis:

1. Clerk dashboard → Webhooks → check delivery log for that user's signup time
2. If the delivery says 401 or 500: check Vercel function logs for `/api/webhooks/clerk`
3. If the delivery says 200 but no DB row: check Sentry for errors in `provisionNewUser`
4. Manual fix: identify the Clerk user ID, run the provisioning manually:

```sql
-- Replace clerk_user_id and email with actual values
INSERT INTO account (name, billing_email, plan_tier)
VALUES ('Acme', 'user@acme.com', 'free_forever')
RETURNING id;
-- Then:
INSERT INTO "user" (account_id, clerk_user_id, work_email, full_name, role)
VALUES ('<account-id-from-above>', '<clerk-user-id>', 'user@acme.com', 'User Name', 'owner');
```

Replay the webhook from Clerk dashboard if you want the welcome email to still send.

### "A customer paid via Stripe but their plan didn't upgrade"

The Stripe webhook didn't fire or failed. Diagnosis:

1. Stripe dashboard → Developers → Webhooks → check delivery log
2. If failed: check Vercel function logs for `/api/webhooks/stripe`
3. Most common cause: `STRIPE_WEBHOOK_SECRET` mismatch between Stripe dashboard and Vercel env (test vs. live confusion)
4. Manual fix:

```sql
-- Replace with the actual values from Stripe dashboard
UPDATE account
SET plan_tier = 'starter', stripe_subscription_id = '<sub_xxx>'
WHERE stripe_customer_id = '<cus_xxx>';
```

Replay the webhook from Stripe dashboard so future events are routed correctly.

### "Notice deadline alerts aren't firing"

The Inngest cron didn't fire, or the function failed. Diagnosis:

1. Inngest dashboard → Functions → `notice-deadline-alerts` → most recent run
2. If "Pending" or "Failed": check the run logs
3. If "Succeeded" with `sent: 0`: confirm there are actually subscriptions whose `notice_deadline` is exactly 30/14/7/3/1 days from today (off-by-one is the most common cause)
4. Quick verify in SQL:

```sql
SELECT s.product_name, re.notice_deadline,
       (re.notice_deadline::date - CURRENT_DATE) AS days_until
FROM renewal_event re
JOIN subscription s ON s.id = re.subscription_id
WHERE re.notice_deadline::date - CURRENT_DATE IN (30, 14, 7, 3, 1)
  AND re.status IN ('upcoming', 'notice_window', 'action_needed')
  AND s.status = 'active'
  AND s.auto_renew = true;
```

5. Manual trigger: Inngest dashboard → Invoke → fire the function on demand
6. Email delivery check: query `notification` table for rows with `status = 'failed'`; check `payload->>'error'` for the Resend error message

### "A customer says the cancellation letter is wrong"

The letter generator is a pure function in `src/ui/features/decide-now/cancellation-letter-draft.tsx`. If the customer says the format is off:

1. Open the file, find `generateLetterBody`
2. The template uses customer-supplied fields. If they typed the wrong values, the letter reflects that — not a bug
3. If the bug is structural (e.g., missing line break, wrong date format): fix the template, ship the fix, ping the customer

Never edit a letter on behalf of a customer in their account. They generate, review, and send.

### "I need to give someone access to fix something on the database"

You shouldn't need to in V1. If unavoidable:

1. Create a temporary Neon database user with read-only access via Neon's dashboard
2. Time-box the access (delete the user when done)
3. Document the access in the `RUNBOOK_INCIDENTS.md` (create on first incident)
4. Never share your own credentials

### "Stripe says payment failed and I don't know which customer"

Stripe webhook event has the customer ID. From Stripe dashboard:

1. Events → find the failed event
2. View payload → copy `customer` field
3. Match against `account.stripe_customer_id` in your database

### "An assignee is asking who reclaimed their seat" (V1.5+)

Not relevant in V1 (reclamation is V1.5). When it is: query `assignment_history` filtered to that seat — every action records actor and reason.

## Press-the-big-red-button procedures

### Stop all customer-facing communications

1. Stripe Dashboard → Developers → Webhooks → temporarily disable the endpoint
2. Inngest Dashboard → Functions → pause `notice-deadline-alerts` and `renewal-event-state-update`
3. Don't disable Clerk webhook — that only handles new sign-ups, which you may want to allow

### Roll back the most recent deploy

1. Vercel Dashboard → Deployments → find the previous successful deploy
2. Click the three-dot menu → "Promote to Production"
3. Verify on production within 30 seconds

### Restore the database from backup

See `docs/DATA_RECOVERY.md`. Do not perform restore unless you've practiced it.

### Disable new signups

There's no built-in toggle in V1. Quick options:

1. **Code change:** Add `if (!process.env.ALLOW_SIGNUPS) redirect("/maintenance")` at the top of `src/app/sign-up/[[...sign-up]]/page.tsx`. Deploy.
2. **Clerk allowlist:** In Clerk dashboard, restrict sign-ups to specific email domains.

## Customer communication templates

### "We had an outage — apology email"

```
Subject: Renewal Radar — brief outage today

Hi [first name],

Renewal Radar was unreachable between [start time] and [end time] [TZ] today
due to [one-line cause].

Service is fully restored. Your notice deadline alerts continue to be
processed by our scheduled job; nothing was missed.

If you tried to log in during that window and got an error, please try again
now. If you see anything still off, reply to this email.

We're sorry for the disruption.

[Your name]
Founder, Renewal Radar
```

### "Your notice deadline alert was wrong"

```
Subject: Re: Your Datadog alert

Hi [first name],

Thanks for flagging. I just checked your account and you're right — the
deadline calculation was off because [specific cause].

I've corrected it on our end and you should now see the right date at
renewalradar.com/subscriptions/[id]. Your next alert will fire on [date].

To prevent this on other subscriptions, [specific instruction].

Sorry for the noise. I owe you one.

[Your name]
```

### "I'm a solo founder and I need to take a day off"

```
Auto-reply: I'm out [day] but checking critical alerts. Renewal Radar's
notice deadline alerts continue to fire automatically. For non-urgent
issues, I'll reply [next business day]. For urgent issues affecting
your account, call/text me at [your-cell].

[Your name]
```

## Founder boundaries (read this when you're tempted to skip them)

- Take Sundays off completely. The product runs without you.
- Maximum 5 customer support emails per evening on weekends.
- If a customer demands you act on their behalf (cancel their vendor for them, log into vendor portal for them), politely decline. The principle is binding. Refer them to the cancellation letter generator.
- If a customer demands a custom feature that breaks the FSD guardrails (action-on-behalf, bank feeds, RPA cancellation), say no and explain the principle. Some customers will leave. Better than building yourself into a labor business.
- If you're burning out, reduce outreach for two weeks before reducing anything else. Existing customer support is more important than acquisition during that window.

## Escalation contacts

If you have any of these, fill them in. If you don't have them yet, get them before you sign 10 paying customers.

- **Fractional CTO / engineering advisor:** _______________
- **Counsel (for contract questions):** _______________
- **Accountant:** _______________
- **Insurance broker (E&O / cyber):** _______________
- **Trusted founder peer (someone you can text at 2am):** _______________

The single biggest predictor of solo-founder burnout in months 4-9 is "nobody to call." Build the rolodex before you need it.
