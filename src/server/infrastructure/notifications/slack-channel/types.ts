/**
 * Slack channel provider — the pluggable seam for account-level Slack delivery.
 *
 * NOTE on scope: Slack here is ACCOUNT-scoped (one webhook per account, posting
 * a digest), not per-recipient like email/in-app. That's why it is its own
 * channel provider rather than a branch inside the per-user
 * `dispatchNotification` — folding an account-level webhook into a per-user
 * fan-out would be a semantic mismatch. The provider abstraction makes the
 * transport swappable + testable without that distortion.
 */

export type SlackMessage = { text: string };

export type SlackPostResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

export interface SlackChannelProvider {
  readonly providerName: string;
  post(webhookUrl: string, message: SlackMessage): Promise<SlackPostResult>;
}
