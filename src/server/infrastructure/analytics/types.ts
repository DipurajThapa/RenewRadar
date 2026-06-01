/**
 * Analytics provider interface.
 *
 * We treat product analytics as a pluggable side-effect, identical in shape
 * to storage / AI extraction / OCR: a small interface, a stub default that
 * works offline, and a "not configured" production stub that you replace
 * with a real PostHog / Segment client once keys are provisioned.
 *
 * Why bother with our own indirection?
 *   1. The whole product runs without a paid analytics account; the stub
 *      writes to the console so the funnel is visible during development.
 *   2. Tests don't need to mock a network client — they swap the provider.
 *   3. Switching from PostHog to Segment (or shipping both in parallel for
 *      migration) becomes a one-file change.
 *
 * Privacy posture:
 *   - We send a stable, hashed accountId and userId as the only identifiers.
 *   - Event properties are small, schema-typed structs — no free-form blobs
 *     and no contract text. Anything sensitive belongs in our DB, not in a
 *     third-party warehouse.
 *   - The provider is allowed to be a no-op (e.g. when the user has explicitly
 *     opted out of telemetry). Callers never block waiting on the result.
 */

/**
 * The closed set of events we care about for the activation funnel. Adding
 * a new event is a deliberate act: extend this union, update every provider's
 * event mapping, and document the property shape in `AnalyticsEventProperties`.
 *
 * Naming convention: `<subject>.<verb_past_tense>` to match PostHog convention.
 */
export type AnalyticsEventName =
  | "user.signed_up"
  | "user.signed_in"
  | "document.uploaded"
  | "extracted_field.accepted"
  | "extracted_field.rejected"
  | "extracted_field.auto_applied"
  | "extracted_field.reverted"
  | "subscription.created"
  | "renewal_decision.logged"
  | "savings_record.created"
  | "vendor.viewed"
  | "weekly_digest.sent";

export type AnalyticsEventProperties = Record<
  string,
  string | number | boolean | null
>;

/**
 * Caller context: who did the thing.
 *
 *   - accountId : tenant. ALWAYS required.
 *   - userId    : actor. Optional for system events (cron jobs).
 *   - tier      : current billing tier, for funnel cohorting.
 */
export type AnalyticsContext = {
  accountId: string;
  userId?: string | null;
  tier?: string | null;
};

export interface AnalyticsProvider {
  readonly providerName: string;

  /**
   * Fire an event. Implementations must NEVER throw — analytics failures must
   * not affect the user-facing flow. They may log internally.
   */
  track(input: {
    event: AnalyticsEventName;
    context: AnalyticsContext;
    properties?: AnalyticsEventProperties;
  }): Promise<void>;

  /**
   * Identify a user (sets durable traits like email, role). Same throw policy.
   */
  identify(input: {
    context: AnalyticsContext;
    traits?: AnalyticsEventProperties;
  }): Promise<void>;
}
