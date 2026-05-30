import { serve } from "inngest/next";
import { inngest } from "@server/jobs/client";
import { noticeDeadlineAlerts } from "@server/jobs/functions/notice-deadline-alerts";
import { renewalEventStateUpdate } from "@server/jobs/functions/renewal-event-state";
import { weeklyDigest, monthlySummary } from "@server/jobs/functions/digests";
import { slackDailySummary } from "@server/jobs/functions/slack-daily-summary";
import { auditRetentionEnforcement } from "@server/jobs/functions/audit-retention";
import { extractDocumentJob } from "@server/jobs/functions/extract-document";
import { pastDueGraceEnforcement } from "@server/jobs/functions/past-due-grace";
import { spendSync } from "@server/jobs/functions/spend-sync";
import { savingsReconciliation } from "@server/jobs/functions/savings-reconciliation";
import { renewalAgent } from "@server/jobs/functions/renewal-agent";

// Functions registered with Inngest:
//   - pastDueGraceEnforcement (02:00 UTC daily)          — bound past-due grace
//   - auditRetentionEnforcement (06:00 UTC daily)        — purge expired audit rows
//   - renewalEventStateUpdate (07:00 UTC daily)          — progress state machine
//   - noticeDeadlineAlerts    (08:00 UTC daily)          — escalating alerts
//   - slackDailySummary       (Mon–Fri 09:00 UTC)        — Slack action-queue post
//   - weeklyDigest            (Mon 09:00 UTC)            — action-queue summary email
//   - monthlySummary          (1st of month 09:00 UTC)   — YTD savings report
//   - extractDocumentJob      (event: document/extract)  — Phase C extraction
//   - spendSync               (06:00 UTC daily)          — auto-ingest + detect recurring charges
//   - savingsReconciliation   (08:00 UTC daily)          — projected→realized savings ROI loop

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    pastDueGraceEnforcement,
    auditRetentionEnforcement,
    renewalEventStateUpdate,
    noticeDeadlineAlerts,
    slackDailySummary,
    weeklyDigest,
    monthlySummary,
    extractDocumentJob,
    spendSync,
    savingsReconciliation,
    renewalAgent,
  ],
});
