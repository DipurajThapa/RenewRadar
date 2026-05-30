/**
 * Email provider interface. Pluggable, mirroring the storage/ocr template:
 * interface + working default (Resend) + key-gated not-configured adapter +
 * env-switch factory + _setForTests. The `sendEmail()` helper is a thin wrapper
 * over the active provider, so all callers stay untouched and a future
 * transport swap (Postmark, SES, …) is a one-file addition.
 */

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult = {
  ok: boolean;
  messageId: string | null;
  error?: string;
};

export interface EmailProvider {
  readonly providerName: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
