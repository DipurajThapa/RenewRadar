/**
 * Analytics factory + safe fire-and-forget helper.
 *
 *   ANALYTICS_PROVIDER=console  (default) → ConsoleStubAnalyticsProvider
 *   ANALYTICS_PROVIDER=posthog            → PostHogNotConfiguredProvider (production stub)
 *   ANALYTICS_PROVIDER=segment            → SegmentNotConfiguredProvider (production stub)
 *
 * Callers should use `recordEvent` / `identifyUser` rather than the provider
 * directly. Those helpers:
 *   1. Swallow errors (analytics must never break a user flow).
 *   2. Don't await — the call returns instantly; the network round-trip
 *      happens in the background.
 *   3. Add the global `tier` / `appEnv` properties so PostHog dashboards can
 *      cohort consistently without each callsite remembering.
 */
import type {
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsEventProperties,
  AnalyticsProvider,
} from "./types";
import { ConsoleStubAnalyticsProvider } from "./console-stub-provider";
import { PostHogNotConfiguredProvider } from "./posthog-not-configured";
import { SegmentNotConfiguredProvider } from "./segment-not-configured";

let cached: AnalyticsProvider | null = null;

export function getAnalyticsProvider(): AnalyticsProvider {
  if (cached) return cached;
  const provider = process.env.ANALYTICS_PROVIDER ?? "console";
  switch (provider) {
    case "posthog":
      cached = new PostHogNotConfiguredProvider();
      break;
    case "segment":
      cached = new SegmentNotConfiguredProvider();
      break;
    case "console":
    default:
      cached = new ConsoleStubAnalyticsProvider();
      break;
  }
  return cached;
}

export function _resetAnalyticsProviderForTests(
  provider?: AnalyticsProvider
): void {
  cached = provider ?? null;
}

/**
 * Fire an event. Never throws. Never blocks the caller — the Promise is
 * intentionally not awaited at the use-case layer.
 *
 * NOTE: We do `void p.catch(...)` rather than `await` so a slow analytics
 * sink can't add latency to (say) a contract upload. The downside is that
 * in tests you must `await` the returned Promise yourself when you want
 * deterministic ordering.
 */
export function recordEvent(input: {
  event: AnalyticsEventName;
  context: AnalyticsContext;
  properties?: AnalyticsEventProperties;
}): Promise<void> {
  const provider = getAnalyticsProvider();
  const enriched: AnalyticsEventProperties = {
    appEnv: process.env.NODE_ENV ?? "development",
    ...(input.properties ?? {}),
  };
  return provider
    .track({ event: input.event, context: input.context, properties: enriched })
    .catch((err) => {
      // Last line of defence — providers shouldn't throw, but if one does
      // (e.g. the not-configured stub) we eat it here so the call site is safe.
      console.error(`[analytics] ${input.event} failed:`, err);
    });
}

export function identifyUser(input: {
  context: AnalyticsContext;
  traits?: AnalyticsEventProperties;
}): Promise<void> {
  const provider = getAnalyticsProvider();
  return provider.identify({ context: input.context, traits: input.traits }).catch(
    (err) => {
      console.error(`[analytics] identify failed:`, err);
    }
  );
}

export type {
  AnalyticsProvider,
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsEventProperties,
} from "./types";
