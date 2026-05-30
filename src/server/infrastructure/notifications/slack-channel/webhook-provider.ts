import type {
  SlackChannelProvider,
  SlackMessage,
  SlackPostResult,
} from "./types";

/**
 * Incoming-webhook Slack channel — the working default. Posts JSON to the
 * account's decrypted webhook URL (behaviour identical to the previous inline
 * fetch in the daily-summary cron).
 */
export class WebhookSlackChannel implements SlackChannelProvider {
  readonly providerName = "webhook";

  async post(
    webhookUrl: string,
    message: SlackMessage
  ): Promise<SlackPostResult> {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      return res.ok
        ? { ok: true, status: res.status }
        : { ok: false, status: res.status, error: `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
