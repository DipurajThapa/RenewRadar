/**
 * Email provider factory.
 *
 *   RESEND_API_KEY set    → ResendEmailProvider (sends)
 *   RESEND_API_KEY absent → EmailNotConfiguredProvider (logs + ok:false)
 *
 * Cached as a module-level singleton so every caller shares one instance.
 */
import type { EmailProvider } from "./types";
import { ResendEmailProvider } from "./resend-provider";
import { EmailNotConfiguredProvider } from "./email-not-configured";

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  cached = apiKey
    ? new ResendEmailProvider(apiKey)
    : new EmailNotConfiguredProvider();
  return cached;
}

/** Test-only: reset the cached provider so each test can install its own. */
export function _resetEmailProviderForTests(
  provider?: EmailProvider | null
): void {
  cached = provider ?? null;
}

export type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
