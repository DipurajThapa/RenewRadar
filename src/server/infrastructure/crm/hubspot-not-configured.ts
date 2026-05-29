/**
 * HubSpot CRM — production scaffold (NOT YET WIRED).
 *
 * To enable when you migrate from Google Sheets:
 *   1. Create a HubSpot private app with `crm.objects.contacts.write` scope.
 *   2. Add `HUBSPOT_PRIVATE_APP_TOKEN` to env.
 *   3. Replace this class with a real implementation that POSTs to
 *      https://api.hubapi.com/crm/v3/objects/contacts with body:
 *
 *      {
 *        properties: {
 *          email: payload.email,
 *          firstname: ...,
 *          lastname: ...,
 *          company: payload.company,
 *          jobtitle: payload.jobTitle,
 *          message: payload.message,
 *          source__c: payload.source,
 *          intent__c: payload.intent,
 *          consent_marketing__c: payload.consentMarketing
 *        }
 *      }
 *
 *      Bearer auth, `Content-Type: application/json`. The HubSpot API will
 *      upsert on email if you use the `idProperty=email` query param.
 *   4. Decide what to do on rate limits — HubSpot caps at 100 req/10 s for
 *      most plans. The current lead volume is well below that; an in-memory
 *      bucket is fine.
 *
 * Until step 3, set `CRM_PROVIDER=hubspot` only after wiring the real
 * implementation. The default `console-stub` keeps the funnel observable.
 */
import type { CrmProvider, LeadPushPayload } from "./types";

export class HubspotNotConfiguredProvider implements CrmProvider {
  readonly providerName = "hubspot-not-configured";

  async pushLead(_payload: LeadPushPayload): Promise<{ ok: boolean }> {
    console.error(
      "[crm] HubSpot provider is not configured. To enable:\n" +
        "  1. Create a HubSpot private app with crm.objects.contacts.write\n" +
        "  2. Set HUBSPOT_PRIVATE_APP_TOKEN in your env\n" +
        "  3. Replace HubspotNotConfiguredProvider with a real client\n" +
        "Until then, leave CRM_PROVIDER unset (defaults to console) or use google-sheets."
    );
    return { ok: false };
  }
}
