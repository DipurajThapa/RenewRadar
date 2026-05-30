import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

/**
 * Resend-backed email provider — the working default when RESEND_API_KEY is set.
 * Behaviour is byte-identical to the previous bare `sendEmail()` singleton.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly providerName = "resend";
  private readonly resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const result = await this.resend.emails.send({
        from:
          process.env.EMAIL_FROM ??
          "Renewal Radar <notifications@renewalradar.com>",
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      });

      if (result.error) {
        return { ok: false, messageId: null, error: result.error.message };
      }
      return { ok: true, messageId: result.data?.id ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[email] send failed", msg);
      return { ok: false, messageId: null, error: msg };
    }
  }
}
