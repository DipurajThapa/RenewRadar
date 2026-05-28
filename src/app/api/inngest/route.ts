import { serve } from "inngest/next";
import { inngest } from "@server/jobs/client";
import { noticeDeadlineAlerts } from "@server/jobs/functions/notice-deadline-alerts";
import { renewalEventStateUpdate } from "@server/jobs/functions/renewal-event-state";
import { weeklyDigest, monthlySummary } from "@server/jobs/functions/digests";
import { slackDailySummary } from "@server/jobs/functions/slack-daily-summary";
import { auditRetentionEnforcement } from "@server/jobs/functions/audit-retention";
import { extractDocumentJob } from "@server/jobs/functions/extract-document";

// Functions registered with Inngest:
//   - auditRetentionEnforcement (06:00 UTC daily)        — purge expired audit rows
//   - renewalEventStateUpdate (07:00 UTC daily)          — progress state machine
//   - noticeDeadlineAlerts    (08:00 UTC daily)          — escalating alerts
//   - slackDailySummary       (Mon–Fri 09:00 UTC)        — Slack action-queue post
//   - weeklyDigest            (Mon 09:00 UTC)            — action-queue summary email
//   - monthlySummary          (1st of month 09:00 UTC)   — YTD savings report
//   - extractDocumentJob      (event: document/extract)  — Phase C extraction

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    auditRetentionEnforcement,
    renewalEventStateUpdate,
    noticeDeadlineAlerts,
    slackDailySummary,
    weeklyDigest,
    monthlySummary,
    extractDocumentJob,
  ],
});
