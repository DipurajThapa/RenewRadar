/**
 * `sendEmail()` — the stable call site every caller imports. It now delegates to
 * the active EmailProvider (see ./index), so the transport is pluggable while
 * this signature stays frozen. Re-exports SendEmailResult for existing importers.
 */
import { getEmailProvider } from "./index";
import type { SendEmailInput, SendEmailResult } from "./types";

export type { SendEmailResult } from "./types";

export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  return getEmailProvider().send(input);
}
