/**
 * CRM provider interface.
 *
 * Identical philosophy to analytics / storage / AI extraction: a small
 * interface, a stub default that works offline, and replaceable real
 * providers (Google Sheets today, HubSpot tomorrow).
 *
 * Privacy posture:
 *   - The payload carries only what the marketing team needs to follow up.
 *   - Implementations MUST treat the email field as PII — no logging, no
 *     URL params, no caching past the operation that needs it.
 *   - The provider is allowed to be a no-op (when CRM is opted out).
 *   - `pushLead` MUST NOT throw — failures are logged and dropped so a
 *     CRM outage never breaks the form.
 */

/**
 * Snapshot of a captured lead in CRM-friendly shape. Source is the page-level
 * taxonomy from `LEAD_SOURCES`; intent is the inferred next-step in the
 * funnel. Both are sent to the CRM so the marketing team can route follow-up.
 */
export type LeadPushPayload = {
  id: string;
  email: string;
  fullName: string | null;
  company: string | null;
  jobTitle: string | null;
  source: string;
  intent: string;
  message: string | null;
  status: string;
  consentMarketing: boolean;
  /**
   * Non-PII attribution data — UTM params, referrer. Provider implementations
   * flatten this into CRM-native shape (Google Sheets columns, HubSpot
   * properties, etc.).
   */
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export interface CrmProvider {
  readonly providerName: string;

  /**
   * Push a lead to the CRM. Returns whether the push succeeded for
   * observability — the caller does not branch on it.
   */
  pushLead(payload: LeadPushPayload): Promise<{ ok: boolean }>;
}
