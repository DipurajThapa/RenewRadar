/**
 * Unit tests for the notification label/destination/preference helpers.
 * Pure functions — no DB.
 */
import { describe, expect, it } from "vitest";
import {
  notificationDestinationUrl,
  notificationTriggerLabel,
  resolveChannelPreference,
} from "@server/domain/notifications/labels";

describe("notificationTriggerLabel", () => {
  it("labels the intake triggers", () => {
    expect(notificationTriggerLabel("intake_request_submitted")).toBe(
      "New purchase request to review"
    );
    expect(notificationTriggerLabel("intake_request_decided")).toBe(
      "Your purchase request was reviewed"
    );
  });

  it("falls back to the raw key for unknown triggers", () => {
    expect(notificationTriggerLabel("something_new")).toBe("something_new");
  });
});

describe("notificationDestinationUrl", () => {
  it("routes intake_request entities to the request detail page", () => {
    expect(
      notificationDestinationUrl("intake_request_submitted", "intake_request", "abc-123")
    ).toBe("/requests/abc-123");
    expect(
      notificationDestinationUrl("intake_request_decided", "intake_request", "def-456")
    ).toBe("/requests/def-456");
  });

  it("still routes subscription entities to the subscription page", () => {
    expect(
      notificationDestinationUrl("notice_window_7", "subscription", "sub-1")
    ).toBe("/subscriptions/sub-1");
  });

  it("falls back to the dashboard when there's no entity", () => {
    expect(notificationDestinationUrl("weekly_digest", null, null)).toBe(
      "/dashboard"
    );
    // intake trigger without an entity id can't deep-link — dashboard fallback
    expect(
      notificationDestinationUrl("intake_request_submitted", "intake_request", null)
    ).toBe("/dashboard");
  });
});

describe("resolveChannelPreference", () => {
  it("defaults both channels on for intake triggers (not locked, no pref)", () => {
    expect(resolveChannelPreference(null, "intake_request_submitted")).toEqual({
      email: true,
      in_app: true,
    });
  });

  it("honors an explicit mute on a single channel", () => {
    const prefs = { intake_request_submitted: { email: false, in_app: true } };
    expect(resolveChannelPreference(prefs, "intake_request_submitted")).toEqual({
      email: false,
      in_app: true,
    });
  });
});
