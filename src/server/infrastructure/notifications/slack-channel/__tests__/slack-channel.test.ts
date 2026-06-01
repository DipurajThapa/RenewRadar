/**
 * Slack channel factory (P2-S6) — env-switch selection + the disabled no-op +
 * test injection.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  getSlackChannel,
  _setSlackChannelForTests,
} from "@server/infrastructure/notifications/slack-channel";

afterEach(() => {
  _setSlackChannelForTests(null);
});

describe("getSlackChannel", () => {
  it("defaults to the webhook provider", () => {
    _setSlackChannelForTests(null);
    const prev = process.env.SLACK_CHANNEL_PROVIDER;
    delete process.env.SLACK_CHANNEL_PROVIDER;
    try {
      expect(getSlackChannel().providerName).toBe("webhook");
    } finally {
      if (prev !== undefined) process.env.SLACK_CHANNEL_PROVIDER = prev;
      _setSlackChannelForTests(null);
    }
  });

  it("uses the disabled no-op when SLACK_CHANNEL_PROVIDER=disabled", async () => {
    _setSlackChannelForTests(null);
    const prev = process.env.SLACK_CHANNEL_PROVIDER;
    process.env.SLACK_CHANNEL_PROVIDER = "disabled";
    try {
      const ch = getSlackChannel();
      expect(ch.providerName).toBe("disabled");
      const r = await ch.post("https://hooks.slack.test/x", { text: "hi" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/disabled/);
    } finally {
      if (prev !== undefined) process.env.SLACK_CHANNEL_PROVIDER = prev;
      else delete process.env.SLACK_CHANNEL_PROVIDER;
      _setSlackChannelForTests(null);
    }
  });

  it("returns an injected test provider", async () => {
    let postedTo: string | null = null;
    _setSlackChannelForTests({
      providerName: "test",
      async post(url) {
        postedTo = url;
        return { ok: true, status: 200 };
      },
    });
    const r = await getSlackChannel().post("https://hooks.slack.test/y", {
      text: "x",
    });
    expect(r.ok).toBe(true);
    expect(postedTo).toBe("https://hooks.slack.test/y");
  });
});
