# Monitoring & Observability

What you watch, how it alerts you, and what action you take.

## Tools

| Tool | What it monitors | Cost |
|---|---|---|
| **Sentry** | Errors (server + client + edge); performance traces | Free Developer plan; Team plan $26/mo when needed |
| **Vercel Analytics** | Page load times, Core Web Vitals, function invocations | Free with Hobby; included in Pro |
| **Inngest dashboard** | Scheduled job runs, success rate | Free tier covers V1 |
| **Stripe dashboard** | Billing events, MRR, churn | Free |
| **Plausible** | Marketing funnel, page views, conversions | $14/mo Starter |
| **BetterUptime** (or Cronitor) | Uptime ping to `/api/health` | Free tier — 10 monitors |
| **Resend** | Email delivery, bounces | Free up to 3K emails/mo |
| **Neon** | Query performance, connection pool, storage | Included in Pro |
| **Clerk** | User signups, sign-in errors, webhook deliveries | Free up to 10K MAU |

You should have all 9 bookmarked. Daily check takes 10 minutes.

## What "healthy" looks like

These are the baselines you compare against. Anything significantly off triggers investigation.

| Metric | Source | Healthy range |
|---|---|---|
| Production error rate | Sentry | <5 errors/day across the whole app |
| Webhook delivery success | Clerk + Stripe dashboards | 100% — any 4xx or 5xx is a problem |
| Daily cron success | Inngest | 100% — both crons succeed every day |
| Health endpoint uptime | BetterUptime | >99.9% (allow 4-minute outage/month) |
| Stripe payment success rate | Stripe | >95% (industry baseline; <90% suggests problem with card on file) |
| Email delivery success | Resend | >99% — bounces should be <1% |
| Dashboard p95 load time | Vercel Analytics | <2 seconds at 100 subs/account |
| Database connection pool | Neon | <50% of max — alarm if sustained >80% |

## Sentry — error tracking

### Setup

Already in your `next.config.mjs` via `withSentryConfig`. The wizard added `sentry.client.config.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts`. Source maps upload on every Vercel deploy.

### Alerting rules to configure

In Sentry → Alerts:

1. **"New error" alert** — fires once when a new error fingerprint appears
   - Conditions: A new issue is created
   - Action: Email you immediately
   - Use case: catches new bugs from a deploy

2. **"Error spike" alert** — fires when error count spikes
   - Conditions: number of events in an issue increases by 50% in the last hour
   - Action: Email you
   - Use case: catches a degradation where one error is suddenly cascading

3. **"5xx from webhooks" alert** — fires on webhook endpoint errors
   - Filter: URL contains `/api/webhooks/`
   - Action: Email + SMS via integration
   - Use case: Stripe and Clerk webhooks failing means customers' state is drifting

### What to do when Sentry fires

1. Open the issue, read the stack trace
2. Check "Tags" → which user, which page, which browser
3. If reproducible: fix it locally, ship the fix
4. If not reproducible: comment on the issue with what you investigated, mark as "needs more info"
5. Don't snooze critical issues. Either fix or document why it's not a fix-now.

## Inngest — scheduled job monitoring

### Daily dashboard check

Open Inngest dashboard → Functions:

- `notice-deadline-alerts` should show "Succeeded" on yesterday's 08:00 UTC run
- `renewal-event-state-update` should show "Succeeded" on yesterday's 07:00 UTC run

### What to look for in the run details

Click into a run:

- `processed` count: how many candidate events were found
- `sent` count: how many emails actually went out
- `skipped` count: dedup'd because already sent earlier
- `failed` count: should be 0

### Alerting

Inngest Dashboard → Settings → Notifications:

- Enable function failure alerts (email)
- Enable "function did not run on schedule" alerts (if the cron doesn't fire when expected)

### Manual invocation for testing

You can invoke either cron manually from the Inngest dashboard — useful for testing changes:

1. Functions → `notice-deadline-alerts` → Invoke
2. Provide an empty payload `{}`
3. Run; check the result

## Stripe — billing monitoring

### Daily dashboard check

Stripe Dashboard:

- **MRR** chart — trending up is good
- **Failed payments** widget — investigate each one
- **Customers** → look for any in "delinquent" status

### Alerting

Stripe Dashboard → Developers → Notifications:

- Enable: failed webhook deliveries (>3 retries)
- Enable: failed payment notifications
- Enable: disputed charges

When a payment fails:

1. Stripe sends the customer a dunning email (automatic)
2. After 3 retries (~21 days), Stripe marks the subscription `unpaid`
3. Your `customer.subscription.updated` webhook fires; my handler keeps the customer on their current tier in `past_due` status
4. If they don't update payment, eventually `customer.subscription.deleted` fires and tier reverts to `free_forever`

You only need to intervene if a high-value customer (Pro/Enterprise) has a sustained payment failure. Reach out personally then.

## Health endpoint

`GET /api/health` returns 200 if the database is reachable, 503 otherwise. No auth required.

### Setup external pinger

BetterUptime (free tier — 10 monitors):

1. New Monitor
2. URL: `https://<your-domain>/api/health`
3. Check interval: 1 minute
4. Alert after: 2 consecutive failures
5. Alert channels: Email + SMS

If you prefer cron-style:

- Cronitor: free for 5 monitors
- UptimeRobot: free for 50 monitors at 5-minute interval

Either works. Get notifications on your phone.

## Plausible — marketing funnel

For acquisition tracking. Set up custom events:

- `signup_completed` — fires after Clerk completes sign-up
- `subscription_added` — fires from successful Server Action
- `decision_logged` — fires from successful decision

Track the conversion funnel:

- Page view `/` → `/sign-up` → signup → subscription added → decision logged

If conversion at any step drops materially, investigate that step.

## Neon — database

### What to monitor

In Neon Dashboard → your project → Monitoring:

- Connection count (should be well below pool limit)
- Storage usage (10 GB on Pro)
- Slow queries (queries over 1 second)

### Quick query for slow queries

```sql
SELECT
  calls,
  total_exec_time,
  mean_exec_time,
  query
FROM pg_stat_statements
WHERE mean_exec_time > 1000  -- over 1 second average
ORDER BY total_exec_time DESC
LIMIT 20;
```

If you see a query with high mean time, check if it's missing an index. The schema in `src/server/infrastructure/db/schema.ts` has indexes for the V1 hot paths; if you add new query patterns, add corresponding indexes.

## Resend — email

### What to watch

Resend dashboard → API → Emails tab:

- Bounce rate (target <1%)
- Spam complaints (target 0)
- Delivery success rate (>99%)

If bounce rate spikes:

- Could be a problematic customer email domain
- Could be a Resend platform issue
- Could be DNS misconfig (SPF/DKIM/DMARC broken)

### Suppressions

Resend manages a suppression list automatically. If a customer says "I'm not getting any emails":

1. Resend dashboard → check the suppression list
2. If their email is on it: remove it, ping them to whitelist `notifications@<your-domain>`

## Alert routing (where alerts go)

Set up so that each alert lands somewhere you'll actually see it:

| Alert | Channel |
|---|---|
| Critical (production down, webhook failing) | SMS to your phone |
| High (new Sentry issue, payment failure) | Email — read daily |
| Medium (slow query, bounce rate up) | Weekly review |
| Low (analytics anomaly) | Monthly review |

Resist the urge to route everything to Slack/SMS. Alert fatigue is real. Spam-level alerts cause you to ignore the important ones.

## When to upgrade tooling

Solo V1 to first 10 customers — free tiers everywhere.

10-50 customers:

- Sentry Team plan ($26/mo) for higher event volume + integrations
- Resend Pro ($20/mo) for higher email volume

50-200 customers:

- Vercel Pro ($20/mo) for better limits
- BetterUptime paid ($25/mo) for SMS + status page

200+ customers:

- Datadog or similar for actual APM
- PagerDuty for proper on-call

You don't need this stack now. Notes for future.

## Postmortem template

When something goes wrong, write a brief postmortem in `RUNBOOK_INCIDENTS.md`:

```markdown
## YYYY-MM-DD — [short title]

**Detected:** how (Sentry, customer report, alert)
**Duration:** start time → end time (minutes)
**Affected:** which customers, what feature

**What happened:**
[1-2 paragraphs of what occurred]

**Root cause:**
[Specific technical cause]

**Resolution:**
[What you did to fix]

**Prevention:**
- [ ] Specific action item
- [ ] Specific action item
```

The brevity is the point. Aim for 15 minutes to write each postmortem. Most issues recur in slightly different forms — past postmortems are your future debugging notes.
