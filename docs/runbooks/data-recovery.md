# Data Recovery & Backup Runbook

How to back up, verify backups, and restore. Untested backups are not backups.

## Backup strategy

Three layers of redundancy. You only need two to be functional after a disaster.

### Layer 1 — Neon point-in-time recovery (PITR)

Neon Pro tier provides PITR. Every write is captured; you can restore the database to any second within the retention window.

**Setup (one-time):**

1. neon.tech → your project → Branches → Settings
2. Enable point-in-time recovery on the production branch
3. Set retention to 30 days for paid customers (7 days minimum)

**Cost:** Included in Neon Pro pricing.

**Restoration time:** ~1-5 minutes from incident detection.

### Layer 2 — Weekly logical backup to object storage

Independent backup that survives if Neon itself has a regional outage.

**Setup:**

```bash
# Run weekly via a cron job, GitHub Action, or Vercel Cron
pg_dump $DATABASE_URL > backups/renewal-radar-$(date +%Y-%m-%d).sql
# Then upload to Cloudflare R2 or S3 with a 90-day lifecycle
```

For solo V1 scale, you can run this manually weekly until volume justifies automation. Add it to your Friday checklist.

**Cost:** ~$1/month at V1 customer count.

**Restoration time:** ~30 minutes (download, create new Neon branch, restore via `psql`).

### Layer 3 — Per-customer CSV export

Each customer can self-export their data at any time from `/settings/account` (V1.5 feature). This isn't a system backup — it's a customer-facing recovery for "I deleted something I shouldn't have."

Not yet implemented. V1.5 backlog.

## What's actually critical to back up

Per table:

| Table | Critical? | Why |
|---|---|---|
| `account` | Yes | Billing relationship, plan tier |
| `user` | Yes | Login linkage to Clerk |
| `vendor` | Yes | Customer-created data |
| `subscription` | **Critical** | The entire product |
| `renewal_event` | **Critical** | Notice deadlines + decisions |
| `notification` | Useful but recoverable | Can be regenerated from renewal events |
| `audit_log` | Useful but recoverable | Customer-visible history; loss is reputational |

Authentication state (Clerk) and billing state (Stripe) are owned by those services — not our problem to back up.

## Quarterly restore test

**The most important part of this runbook.** Without it, your backups don't actually work.

Schedule a 60-minute calendar event quarterly with the title "Restore drill."

Procedure:

1. **Pick a target restore point.** Choose a time roughly 24 hours ago.
2. **Create a restore branch in Neon:**
   - Branches → Create branch → From point in time → 24 hours ago
   - Name it `restore-drill-2026-MM-DD`
3. **Connect a local dev environment to the restore branch:**
   ```bash
   DATABASE_URL="<restore-branch-pooled-url>" pnpm dev
   ```
4. **Run integrity checks:**
   ```sql
   -- Counts should be close to production (allowing for last-day writes)
   SELECT
     (SELECT count(*) FROM account) as accounts,
     (SELECT count(*) FROM "user") as users,
     (SELECT count(*) FROM subscription WHERE status = 'active') as subs,
     (SELECT count(*) FROM renewal_event WHERE status IN ('upcoming','notice_window','action_needed')) as renewals;
   ```
5. **Spot check:** sign in via Clerk dev mode and navigate the restored data. Confirm a known subscription appears with correct data.
6. **Time the procedure.** Document elapsed time in `RUNBOOK_INCIDENTS.md`.
7. **Delete the restore branch** (don't leave drill branches accumulating).

If the drill takes >30 minutes, fix the process before the next quarter.

## Recovery scenarios

### Scenario A — A user accidentally cancelled the wrong subscription

This is the most common "restore" request you'll get.

1. Confirm via the customer's support ticket: subscription ID, time of deletion (audit_log will show it)
2. Check `audit_log` for the `subscription.cancelled` action — you have the full `before` JSON of the subscription at deletion time
3. Re-insert manually:

```sql
-- Replace fields from the audit_log "before" JSON
INSERT INTO subscription (
  id, account_id, vendor_id, product_name, plan_name,
  billing_cycle, term_start_date, term_end_date, auto_renew,
  notice_period_days, total_seats, unit_price_cents,
  total_cost_per_period_cents, status, notes, owner_user_id
) VALUES (...);
```

Easier alternative: just UPDATE the existing soft-deleted row back to `status = 'active'`:

```sql
UPDATE subscription SET status = 'active'
WHERE id = '<sub-id>'
  AND account_id = '<account-id>'
  AND status = 'cancelled';
```

The renewal event still exists too (we cascade-delete is on, but soft-delete keeps the parent — so the renewal events remain).

### Scenario B — A bug deleted multiple subscriptions

Restore from PITR:

1. Identify the time window (Sentry timestamp of the bug deploy, or first customer report)
2. Neon → create restore branch from "just before the bug"
3. Connect to restore branch, identify the affected subscriptions:

```sql
-- Get the subscriptions that existed before but don't in production
SELECT id, account_id, product_name FROM subscription
WHERE account_id IN (<affected-accounts>);
```

4. Export those rows from the restore branch:

```bash
psql <restore-branch-url> -c "\COPY (SELECT * FROM subscription WHERE id IN (...)) TO 'recovered.csv' CSV HEADER"
```

5. Re-insert into production:

```bash
psql <production-url> -c "\COPY subscription FROM 'recovered.csv' CSV HEADER"
```

6. Verify in production with a query.
7. Email affected customers with apology and explanation.

### Scenario C — Catastrophic data loss (regional Neon outage, schema corruption)

The bad scenario. Hope you've tested for this in your quarterly drill.

1. **Communicate immediately.** Email all customers with a status update. Don't disappear silently.
2. **Restore from weekly logical backup:**
   - Download most recent `.sql` dump from R2/S3
   - Create a fresh Neon project (in a different region if Neon is having regional issues)
   - `psql <new-prod-url> < renewal-radar-2026-MM-DD.sql`
   - Update Vercel `DATABASE_URL` to point at new project
   - Vercel auto-redeploys
3. **Data gap:** any writes between the dump and the incident are lost. Honest customer communication required.
4. **Postmortem.** Document what happened, time to detect, time to restore, what to change.

### Scenario D — Account deletion (customer self-service in V1.5)

V1 has no self-serve account deletion. If a customer requests deletion via email:

1. Confirm via separate channel that it's really them
2. Export their data first and email it to them
3. Soft-delete:

```sql
-- This cascades through the foreign keys
DELETE FROM account WHERE id = '<account-id>';
```

4. Document the deletion request in `data_deletion_log.txt` (manual log for now; V1.5 adds proper deletion logging)
5. Stripe: cancel any active subscription via the Stripe Dashboard
6. Clerk: delete the user(s) via the Clerk Dashboard

Per privacy policy, you have 60 days to act on a deletion request. Don't put it off.

## Backup verification checklist

Run this once per quarter as part of the restore drill:

- [ ] Most recent PITR restore point is within retention window
- [ ] Most recent logical backup `.sql` file exists in R2/S3 and is dated within the last 7 days
- [ ] Restore drill completed; all 5 verification queries passed
- [ ] No "drill" branches left in Neon (delete after each drill)
- [ ] No "drill" data left in test Clerk environment

## What you should NOT back up

- Clerk users — Clerk owns auth state; restoring stale auth tokens is worse than no restore
- Stripe billing state — Stripe is the source of truth
- Resend email logs — recoverable from Resend's own retention
- Inngest function run history — recoverable from Inngest's own retention
- Vercel deploy logs — recoverable from Vercel's own retention

Backing up things you don't own creates a maintenance burden and a false sense of safety.

## RPO and RTO targets

**Recovery Point Objective (RPO):** how much data can you afford to lose?

- V1 target: **24 hours.** Most customer changes are reversible by re-doing the action.
- Achieved by: PITR (60 seconds RPO) + weekly logical backup (7-day RPO as fallback)

**Recovery Time Objective (RTO):** how long can the system be down?

- V1 target: **2 hours** for full restoration from any single-layer failure
- Achieved by: PITR restore in ~5 min; logical backup restore in ~30 min; full Vercel redeploy in ~5 min

Both targets should improve as the business grows. At $50K MRR, the RTO should be under 30 minutes.

## Documentation of past incidents

Create `RUNBOOK_INCIDENTS.md` (sibling of this file) the first time anything goes wrong. Log:

- Date and time (detection, resolution)
- What happened
- What was affected (which customers, how many)
- What restored it
- What you changed to prevent recurrence

The incidents log is the second most valuable document you'll ever write about this product.
