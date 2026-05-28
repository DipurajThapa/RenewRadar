import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { noticeDeadlineAlerts } from "@/inngest/functions/notice-deadline-alerts";
import { renewalEventStateUpdate } from "@/inngest/functions/renewal-event-state";
import { weeklyDigest, monthlySummary } from "@/inngest/functions/digests";
import { slackDailySummary } from "@/inngest/functions/slack-daily-summary";

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
