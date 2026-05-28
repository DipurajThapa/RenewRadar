import { eq } from "drizzle-orm";
import { inngest } from "@server/jobs/client";
import { db } from "@server/infrastructure/db/client";
import { accountsTable, integrationsTable } from "@server/infrastructure/db/schema";
import { listActionQueueRows } from "@server/infrastructure/db/repositories/action-queue";
import { decryptJson } from "@server/infrastructure/crypto/envelope";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://renewalradar.com";

/**
 * Daily Slack action-queue summary.
 *
 * Runs every weekday at 09:00 UTC. For each account with an enabled Slack
 * integration, posts a brief message summarizing the action queue.
 *
 * Posts only if there are high or medium band rows — no Slack on quiet days.
 * (Weekly digest fills in for "all clear" reassurance via email.)
 */
export const slackDailySummary = inngest.createFunction(
  {
    id: "slack-daily-summary",
    name: "Daily Slack action-queue summary",
    retries: 3,
  },
  { cron: "0 9 * * 1-5" }, // Mon–Fri at 09:00 UTC
  async ({ step }) => {
    const accounts = await step.run("list-accounts", async () =>
      db.select().from(accountsTable)
    );

    let posted = 0;
    let skipped = 0;

    for (const account of accounts) {
      const [integration] = await step.run(`slack-${account.id}`, async () =>
        db
          .select()
          .from(integrationsTable)
          .where(eq(integrationsTable.accountId, account.id))
      );
      if (!integration || integration.kind !== "slack_webhook" || !integration.enabled) {
        skipped++;
        continue;
      }

      let webhookUrl: string;
      try {
        const config = decryptJson<{ webhookUrl: string }>(
          account.id,
          integration.configCiphertext
        );
        webhookUrl = config.webhookUrl;
      } catch (err) {
        console.error(
          `[slack-daily-summary] decrypt failed for ${account.id}:`,
          err
        );
        skipped++;
        continue;
      }

      const queue = await step.run(`queue-${account.id}`, async () =>
        listActionQueueRows(account.id)
      );
      const high = queue.filter((r) => r.risk.band === "high");
      const medium = queue.filter((r) => r.risk.band === "medium");
      if (high.length === 0 && medium.length === 0) {
        skipped++;
        continue;
      }

      const lines: string[] = [];
      lines.push(
        `*Renewal Radar — action queue for ${account.name}*: ${high.length} high · ${medium.length} medium`
      );
      const top = [...high, ...medium].slice(0, 5);
      for (const r of top) {
        const days = r.daysUntilNoticeDeadline;
        const daysLabel =
          days <= 0
            ? `:warning: ${Math.abs(days)}d overdue`
            : `in ${days}d`;
        lines.push(
          `• <${APP_URL}/subscriptions/${r.subscriptionId}/decide?event=${r.renewalEventId}|${r.vendorName} — ${r.productName}> · ${daysLabel} · $${Math.round(r.annualValueCents / 100).toLocaleString("en-US")}/yr · ${r.risk.band.toUpperCase()} (${r.risk.score})`
        );
      }
      if (queue.length > 5) {
        lines.push(`<${APP_URL}/action-queue|See all ${queue.length} →>`);
      }

      const result = await step.run(`post-${account.id}`, async () =>
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: lines.join("\n") }),
        })
      );

      if (result.ok) {
        posted++;
      } else {
        console.error(
          `[slack-daily-summary] post failed for ${account.id}: ${result.status}`
        );
        skipped++;
      }
    }

    return { posted, skipped, accounts: accounts.length };
  }
);
