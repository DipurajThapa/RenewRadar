/**
 * EmailProvider factory (P2-S6) — env-switch selection + the not-configured
 * adapter's graceful degrade. Mirrors the AI factory's env-toggle test pattern.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  getEmailProvider,
  _resetEmailProviderForTests,
} from "@server/infrastructure/email";
import { sendEmail } from "@server/infrastructure/email/client";

afterEach(() => {
  _resetEmailProviderForTests(null);
});

describe("getEmailProvider", () => {
  it("selects the not-configured provider when RESEND_API_KEY is absent", async () => {
    _resetEmailProviderForTests(null);
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const provider = getEmailProvider();
      expect(provider.providerName).toBe("not-configured");
      const r = await provider.send({
        to: "x@example.com",
        subject: "hi",
        html: "<p>hi</p>",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/RESEND_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev;
      _resetEmailProviderForTests(null);
    }
  });

  it("selects the Resend provider when RESEND_API_KEY is present", () => {
    _resetEmailProviderForTests(null);
    const prev = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_not_real";
    try {
      expect(getEmailProvider().providerName).toBe("resend");
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev;
      else delete process.env.RESEND_API_KEY;
      _resetEmailProviderForTests(null);
    }
  });

  it("sendEmail() delegates to an injected test provider", async () => {
    let captured: string | null = null;
    _resetEmailProviderForTests({
      providerName: "test",
      async send(input) {
        captured = Array.isArray(input.to) ? input.to[0]! : input.to;
        return { ok: true, messageId: "test-id" };
      },
    });
    const r = await sendEmail({
      to: "captured@example.com",
      subject: "s",
      html: "<p>h</p>",
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe("test-id");
    expect(captured).toBe("captured@example.com");
  });
});
