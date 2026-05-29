import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleStubAnalyticsProvider } from "@server/infrastructure/analytics/console-stub-provider";
import { PostHogNotConfiguredProvider } from "@server/infrastructure/analytics/posthog-not-configured";
import { SegmentNotConfiguredProvider } from "@server/infrastructure/analytics/segment-not-configured";
import {
  _resetAnalyticsProviderForTests,
  getAnalyticsProvider,
  identifyUser,
  recordEvent,
} from "@server/infrastructure/analytics";
import type { AnalyticsProvider } from "@server/infrastructure/analytics/types";

describe("ConsoleStubAnalyticsProvider", () => {
  const provider = new ConsoleStubAnalyticsProvider();
  // The provider routes through the structured logger, which emits at
  // `console.info` (info-level) — not `console.log`. The logger owns the
  // JSON envelope; we assert the analytics-specific fields it carries.
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits a single structured line per track event", async () => {
    await provider.track({
      event: "user.signed_up",
      context: { accountId: "acc_1", userId: "user_1", tier: "free" },
      properties: { source: "self-serve" },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const json = JSON.parse(line);
    expect(json.level).toBe("info");
    expect(json.event).toBe("analytics_track");
    expect(json.component).toBe("analytics.console-stub");
    expect(json.analyticsEvent).toBe("user.signed_up");
    expect(json.accountId).toBe("acc_1");
    expect(json.userId).toBe("user_1");
    expect(json.properties).toEqual({ source: "self-serve" });
  });

  it("emits identify events with traits", async () => {
    await provider.identify({
      context: { accountId: "acc_1", userId: "user_1" },
      traits: { role: "owner" },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const json = JSON.parse(line);
    expect(json.event).toBe("analytics_identify");
    expect(json.traits).toEqual({ role: "owner" });
  });

  it("never throws even when properties contain odd values", async () => {
    await expect(
      provider.track({
        event: "document.uploaded",
        context: { accountId: "acc_1" },
        properties: { size: 0, ok: false, note: null },
      })
    ).resolves.toBeUndefined();
  });
});

describe("Not-configured providers", () => {
  it("PostHog stub throws a helpful message at call time", async () => {
    const provider = new PostHogNotConfiguredProvider();
    await expect(
      provider.track({
        event: "user.signed_up",
        context: { accountId: "acc_1" },
      })
    ).rejects.toThrow(/PostHog analytics provider is not configured/);
  });

  it("Segment stub throws a helpful message at call time", async () => {
    const provider = new SegmentNotConfiguredProvider();
    await expect(
      provider.identify({ context: { accountId: "acc_1" } })
    ).rejects.toThrow(/Segment analytics provider is not configured/);
  });
});

describe("analytics factory", () => {
  const originalProvider = process.env.ANALYTICS_PROVIDER;

  afterEach(() => {
    _resetAnalyticsProviderForTests();
    if (originalProvider === undefined) delete process.env.ANALYTICS_PROVIDER;
    else process.env.ANALYTICS_PROVIDER = originalProvider;
  });

  it("defaults to the console stub", () => {
    delete process.env.ANALYTICS_PROVIDER;
    _resetAnalyticsProviderForTests();
    expect(getAnalyticsProvider().providerName).toBe("console-stub");
  });

  it("returns the PostHog stub when ANALYTICS_PROVIDER=posthog", () => {
    process.env.ANALYTICS_PROVIDER = "posthog";
    _resetAnalyticsProviderForTests();
    expect(getAnalyticsProvider().providerName).toBe("posthog-not-configured");
  });

  it("returns the Segment stub when ANALYTICS_PROVIDER=segment", () => {
    process.env.ANALYTICS_PROVIDER = "segment";
    _resetAnalyticsProviderForTests();
    expect(getAnalyticsProvider().providerName).toBe("segment-not-configured");
  });

  it("caches the resolved provider", () => {
    delete process.env.ANALYTICS_PROVIDER;
    _resetAnalyticsProviderForTests();
    expect(getAnalyticsProvider()).toBe(getAnalyticsProvider());
  });
});

describe("recordEvent / identifyUser helpers", () => {
  // Capture calls into an in-memory provider so we don't care about console.
  class CapturingProvider implements AnalyticsProvider {
    readonly providerName = "test-capture";
    tracks: Array<{ event: string; context: unknown; properties: unknown }> = [];
    identifies: Array<{ context: unknown; traits: unknown }> = [];
    async track(input: {
      event: string;
      context: unknown;
      properties?: unknown;
    }): Promise<void> {
      this.tracks.push({
        event: input.event,
        context: input.context,
        properties: input.properties,
      });
    }
    async identify(input: {
      context: unknown;
      traits?: unknown;
    }): Promise<void> {
      this.identifies.push({ context: input.context, traits: input.traits });
    }
  }

  let capture: CapturingProvider;
  beforeEach(() => {
    capture = new CapturingProvider();
    _resetAnalyticsProviderForTests(capture as unknown as AnalyticsProvider);
  });
  afterEach(() => {
    _resetAnalyticsProviderForTests();
  });

  it("forwards events and enriches with appEnv", async () => {
    await recordEvent({
      event: "document.uploaded",
      context: { accountId: "acc_1", userId: "user_1" },
      properties: { sizeBytes: 1234 },
    });
    expect(capture.tracks).toHaveLength(1);
    const t = capture.tracks[0]!;
    expect(t.event).toBe("document.uploaded");
    expect((t.properties as Record<string, unknown>).appEnv).toBeDefined();
    expect((t.properties as Record<string, unknown>).sizeBytes).toBe(1234);
  });

  it("swallows errors from a broken provider", async () => {
    class ThrowingProvider implements AnalyticsProvider {
      readonly providerName = "throwing";
      async track(): Promise<void> {
        throw new Error("boom");
      }
      async identify(): Promise<void> {
        throw new Error("also boom");
      }
    }
    _resetAnalyticsProviderForTests(new ThrowingProvider());
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await expect(
      recordEvent({
        event: "user.signed_up",
        context: { accountId: "acc_1" },
      })
    ).resolves.toBeUndefined();
    await expect(
      identifyUser({ context: { accountId: "acc_1" } })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
