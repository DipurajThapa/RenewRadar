import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

/**
 * The not-configured email provider — selected when RESEND_API_KEY is absent.
 * Logs the email instead of sending and returns a clear ok:false (the exact
 * behaviour the previous keyless `sendEmail()` branch had), so dev + CI never
 * attempt outbound mail and callers degrade gracefully.
 */
export class EmailNotConfiguredProvider implements EmailProvider {
  readonly providerName = "not-configured";

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.warn(
      "[email] RESEND_API_KEY not set; logging email instead of sending",
      { to: input.to, subject: input.subject }
    );
    return { ok: false, messageId: null, error: "RESEND_API_KEY not set" };
  }
}
