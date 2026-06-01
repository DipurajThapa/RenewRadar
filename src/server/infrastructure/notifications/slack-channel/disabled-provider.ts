import type {
  SlackChannelProvider,
  SlackMessage,
  SlackPostResult,
} from "./types";

/**
 * No-op Slack channel — selected with SLACK_CHANNEL_PROVIDER=disabled (CI, or an
 * environment where outbound Slack should be suppressed). Never makes a network
 * call; always reports ok:false so callers count it as skipped.
 */
export class DisabledSlackChannel implements SlackChannelProvider {
  readonly providerName = "disabled";

  async post(
    _webhookUrl: string,
    _message: SlackMessage
  ): Promise<SlackPostResult> {
    return { ok: false, error: "slack outbound disabled" };
  }
}
