import { serve } from "inngest/next";
import { inngest } from "@server/jobs/client";
import { noticeDeadlineAlerts } from "@server/jobs/functions/notice-deadline-alerts";
import { renewalEventStateUpdate } from "@server/jobs/functions/renewal-event-state";
import { weeklyDigest, monthlySummary } from "@server/jobs/functions/digests";
import { slackDailySummary } from "@server/jobs/functions/slack-daily-summary";

// Functions registered with Inngest:
//   - renewalEventStateUpdate (07:00 UTC daily)        — progress state machine
//   - noticeDeadlineAlerts    (08:00 UTC daily)        — escalating alerts
//   - slackDailySummary       (Mon–Fri 09:00 UTC)      — Slack action-queue post
//   - weeklyDigest            (Mon 09:00 UTC)          — action-queue summary email
//   - monthlySummary          (1st of month 09:00 UTC) — YTD savings report

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    renewalEventStateUpdate,
    noticeDeadlineAlerts,
    slackDailySummary,
    weeklyDigest,
    monthlySummary,
  ],
});
