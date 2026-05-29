/**
 * CRM provider factory + safe fire-and-forget helper.
 *
 *   CRM_PROVIDER=console  (default) → ConsoleStubCrmProvider
 *   CRM_PROVIDER=google-sheets       → GoogleSheetsCrmProvider
 *   CRM_PROVIDER=hubspot             → HubspotNotConfiguredProvider (scaffold)
 *
 * Callers should use `pushLeadToCrm` rather than the provider directly.
 * That helper:
 *   - Returns immediately (the network round-trip happens in the background).
 *   - Never throws — CRM failure must not affect the lead-capture flow.
 *   - Adds defence-in-depth logging if the provider misbehaves.
 *
 * The Google Sheets provider requires three env vars; the factory falls
 * back to the console stub (with a one-line warning) when they're missing
 * so a misconfigured deploy doesn't lose leads.
 */
import { ConsoleStubCrmProvider } from "./console-stub-provider";
import { GoogleSheetsCrmProvider } from "./google-sheets-provider";
import { HubspotNotConfiguredProvider } from "./hubspot-not-configured";
import type { CrmProvider, LeadPushPayload } from "./types";

let cached: CrmProvider | null = null;

export function getCrmProvider(): CrmProvider {
  if (cached) return cached;
  const provider = process.env.CRM_PROVIDER ?? "console";
  switch (provider) {
    case "google-sheets":
      cached = buildGoogleSheetsProviderOrFallback();
      break;
    case "hubspot":
      cached = new HubspotNotConfiguredProvider();
      break;
    case "console":
    default:
      cached = new ConsoleStubCrmProvider();
      break;
  }
  return cached;
}

export function _resetCrmProviderForTests(provider?: CrmProvider): void {
  cached = provider ?? null;
}

/**
 * Push a lead to the CRM in the background. Returns a Promise so callers
 * can `await` it in tests, but production call sites should `void` the
 * call so the form response is not blocked on CRM availability.
 */
export function pushLeadToCrm(payload: LeadPushPayload): Promise<void> {
  const provider = getCrmProvider();
  return provider
    .pushLead(payload)
    .then(() => undefined)
    .catch((err) => {
      // Last line of defence — providers shouldn't throw, but if one does
      // we eat it so the lead capture flow stays clean.
      console.error(`[crm] pushLead via ${provider.providerName} threw:`, err);
    });
}

function buildGoogleSheetsProviderOrFallback(): CrmProvider {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE;
  if (!clientEmail || !privateKey || !spreadsheetId) {
    console.warn(
      "[crm] CRM_PROVIDER=google-sheets but env is incomplete; " +
        "missing one of GOOGLE_SERVICE_ACCOUNT_EMAIL, " +
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_SHEETS_SPREADSHEET_ID. " +
        "Falling back to console-stub so leads still flow."
    );
    return new ConsoleStubCrmProvider();
  }
  return new GoogleSheetsCrmProvider({
    clientEmail,
    privateKey,
    spreadsheetId,
    range,
  });
}

export type { CrmProvider, LeadPushPayload } from "./types";
