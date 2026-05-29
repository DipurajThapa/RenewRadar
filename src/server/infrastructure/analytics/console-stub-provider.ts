/**
 * Console-stub analytics provider — the default during development and the
 * fallback when no real analytics is configured.
 *
 * What it gives you:
 *   - Every event prints a single structured line to stdout. Easy to grep,
 *     trivially auditable, no network calls.
 *   - The activation funnel is observable on day one without a PostHog
 *     account: you can see `[analytics] user.signed_up …` and
 *     `[analytics] document.uploaded …` in the dev console.
 *
 * In production you swap this for `PostHogProvider` or `SegmentProvider`
 * (see the not-configured stubs in this folder).
 */
import { createLogger } from "@server/infrastructure/observability/logger";
import type {
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsEventProperties,
  AnalyticsProvider,
} from "./types";

const PROVIDER_NAME = "console-stub";
const log = createLogger({ component: "analytics.console-stub" });

export class ConsoleStubAnalyticsProvider implements AnalyticsProvider {
  readonly providerName = PROVIDER_NAME;

  async track(input: {
    event: AnalyticsEventName;
    context: AnalyticsContext;
    properties?: AnalyticsEventProperties;
  }): Promise<void> {
    try {
      // Route through the structured logger so analytics events land in the
      // same JSON stream as everything else. The logger's first arg becomes
      // the entry's `event` field — we use that for the canonical log name
      // and pass the analytics event name in `analyticsEvent` to avoid a
      // field-name collision.
      log.info("analytics_track", {
        analyticsEvent: input.event,
        accountId: input.context.accountId,
        userId: input.context.userId ?? null,
        tier: input.context.tier ?? null,
        properties: input.properties ?? {},
      });
    } catch (err) {
      // Belt-and-braces. Analytics must never break the user-facing flow.
      log.error("analytics_console_stub_track_failed", err);
    }
  }

  async identify(input: {
    context: AnalyticsContext;
    traits?: AnalyticsEventProperties;
  }): Promise<void> {
    try {
      log.info("analytics_identify", {
        accountId: input.context.accountId,
        userId: input.context.userId ?? null,
        tier: input.context.tier ?? null,
        traits: input.traits ?? {},
      });
    } catch (err) {
      log.error("analytics_console_stub_identify_failed", err);
    }
  }
}
