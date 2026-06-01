/**
 * Slack channel factory.
 *
 *   SLACK_CHANNEL_PROVIDER=webhook (default) → WebhookSlackChannel (posts)
 *   SLACK_CHANNEL_PROVIDER=disabled          → DisabledSlackChannel (no-op)
 *
 * Cached as a module-level singleton.
 */
import type { SlackChannelProvider } from "./types";
import { WebhookSlackChannel } from "./webhook-provider";
import { DisabledSlackChannel } from "./disabled-provider";

let cached: SlackChannelProvider | null = null;

export function getSlackChannel(): SlackChannelProvider {
  if (cached) return cached;
  const provider = process.env.SLACK_CHANNEL_PROVIDER ?? "webhook";
  cached =
    provider === "disabled"
      ? new DisabledSlackChannel()
      : new WebhookSlackChannel();
  return cached;
}

/** Test-only: reset the cached provider so each test can install its own. */
export function _setSlackChannelForTests(
  provider?: SlackChannelProvider | null
): void {
  cached = provider ?? null;
}

export type {
  SlackChannelProvider,
  SlackMessage,
  SlackPostResult,
} from "./types";
