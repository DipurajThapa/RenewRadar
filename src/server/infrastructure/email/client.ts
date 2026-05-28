import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const resend = apiKey ? new Resend(apiKey) : null;

type SendEmailInput = {
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

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!resend) {
    console.warn(
      "[email] RESEND_API_KEY not set; logging email instead of sending",
      { to: input.to, subject: input.subject }
    );
    return { ok: false, messageId: null, error: "RESEND_API_KEY not set" };
  }

  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Renewal Radar <notifications@renewalradar.com>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });

    if (result.error) {
      return {
        ok: false,
        messageId: null,
        error: result.error.message,
      };
    }

    return {
      ok: true,
      messageId: result.data?.id ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email] send failed", msg);
    return { ok: false, messageId: null, error: msg };
  }
}
