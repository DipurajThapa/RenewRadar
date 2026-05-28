# `src/server/jobs/`

Inngest background jobs. Each function in `functions/` is registered with the Inngest serve handler at `src/app/api/inngest/route.ts`.

| Function | Schedule | What it does |
|---|---|---|
| `renewal-event-state` | 07:00 UTC daily | State machine: `upcoming → notice_window → action_needed → missed` |
| `notice-deadline-alerts` | 08:00 UTC daily | Emails 30/14/7/3/1-day notice-deadline alerts; emits in-app rows respecting per-user prefs |
| `slack-daily-summary` | Mon–Fri 09:00 UTC | Posts a daily action-queue summary to each account's configured Slack webhook |
| `digests.weeklyDigest` | Mon 09:00 UTC | Weekly action-queue email |
| `digests.monthlySummary` | 1st of month 09:00 UTC | YTD savings + missed-deadline summary email |
| `audit-retention` | 06:00 UTC daily | Purges audit-log rows past each account's tier-based retention window |

Jobs are not allowed to:

- Write to `auditLogTable` directly (use `writeAuditLog(db, ...)` outside a transaction, or wrap in one).
- Skip per-tenant concurrency caps when calling expensive infrastructure (relevant for the future AI extraction job).
