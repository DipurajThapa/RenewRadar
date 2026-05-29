/**
 * Segment analytics — production scaffold.
 *
 * The real implementation:
 *   1. pnpm add @segment/analytics-node
 *   2. Set SEGMENT_WRITE_KEY in env
 *   3. Construct a singleton Analytics client at module load
 *   4. Map track() → analytics.track({ userId: userId ?? accountId, event,
 *      properties: { accountId, tier, ...properties } })
 *   5. Map identify() → analytics.identify({ userId, traits })
 *   6. Call analytics.closeAndFlush() during graceful shutdown
 *
 * Until then, set ANALYTICS_PROVIDER=segment only after wiring this up.
 */
import type {
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsEventProperties,
  AnalyticsProvider,
} from "./types";

export class SegmentNotConfiguredProvider implements AnalyticsProvider {
  readonly providerName = "segment-not-configured";

  async track(_input: {
    event: AnalyticsEventName;
    context: AnalyticsContext;
    properties?: AnalyticsEventProperties;
  }): Promise<void> {
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
    "Segment analytics provider is not configured. To enable:\n" +
      "  1. pnpm add @segment/analytics-node\n" +
      "  2. Set SEGMENT_WRITE_KEY in your env\n" +
      "  3. Replace this class with a real Segment client.\n" +
      "Until then, leave ANALYTICS_PROVIDER unset (defaults to console)."
  );
}
