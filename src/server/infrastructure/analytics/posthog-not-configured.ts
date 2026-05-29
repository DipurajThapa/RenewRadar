/**
 * PostHog analytics — production scaffold.
 *
 * The real implementation:
 *   1. pnpm add posthog-node
 *   2. Set POSTHOG_API_KEY and (optionally) POSTHOG_HOST in env
 *   3. Construct a singleton PostHog client at module load
 *   4. Map track() → client.capture({ distinctId: userId ?? accountId,
 *      event, properties: { accountId, tier, ...properties } })
 *   5. Map identify() → client.identify({ distinctId, properties: traits })
 *   6. Call client.shutdown() during graceful shutdown so the queue flushes
 *
 * Until then, set ANALYTICS_PROVIDER=posthog only after wiring this up. The
 * default (ANALYTICS_PROVIDER=console) keeps the funnel observable without
 * a paid account.
 */
import type {
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsEventProperties,
  AnalyticsProvider,
} from "./types";

export class PostHogNotConfiguredProvider implements AnalyticsProvider {
  readonly providerName = "posthog-not-configured";

  async track(_input: {
    event: AnalyticsEventName;
    context: AnalyticsContext;
    properties?: AnalyticsEventProperties;
  }): Promise<void> {
    // Throw lazily — we only want to alert the operator if events are
    // actually being fired, not at module load. That makes ANALYTICS_PROVIDER
    // toggleable in CI even without keys.
    throw notConfigured();
  }

  async identify(_input: {
    context: AnalyticsContext;
    traits?: AnalyticsEventProperties;
  }): Promise<void> {
    throw notConfigured();
  }
}

function notConfigured(): Error {
  return new Error(
    "PostHog analytics provider is not configured. To enable:\n" +
      "  1. pnpm add posthog-node\n" +
      "  2. Set POSTHOG_API_KEY (and optionally POSTHOG_HOST) in your env\n" +
      "  3. Replace this class with a real PostHog client.\n" +
      "Until then, leave ANALYTICS_PROVIDER unset (defaults to console)."
  );
}
