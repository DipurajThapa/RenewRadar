/**
 * Console-stub CRM provider — the development default.
 *
 * Prints a structured line per lead push to stdout. Lets you see the funnel
 * working before any CRM account is provisioned, and stays as the safe
 * default in CI / staging where the live Google Sheet shouldn't receive
 * test traffic.
 */
import { createLogger } from "@server/infrastructure/observability/logger";
import type { CrmProvider, LeadPushPayload } from "./types";

const log = createLogger({ component: "crm.console-stub" });

export class ConsoleStubCrmProvider implements CrmProvider {
  readonly providerName = "console-stub";

  async pushLead(payload: LeadPushPayload): Promise<{ ok: boolean }> {
    try {
      // Goes through the structured logger so the funnel line lands in the
      // same JSON stream as everything else — easy to grep / index in dev
      // and forwarded to Sentry breadcrumbs in prod.
      log.info("crm_push_lead", {
        leadId: payload.id,
        email: payload.email,
        company: payload.company,
        source: payload.source,
        intent: payload.intent,
        createdAt: payload.createdAt.toISOString(),
      });
      return { ok: true };
    } catch (err) {
      // Provider implementations must not throw. Log and report.
      log.error("crm_console_stub_push_failed", err);
      return { ok: false };
    }
  }
}
