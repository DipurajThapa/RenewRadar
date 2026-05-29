/**
 * Vendor event payload shapes.
 *
 * The vendor_event table stores `payload` as JSONB — every event kind has
 * a typed payload contract documented here. When you add a new event kind:
 *   1. Add it to `vendorEventKindEnum` in schema.ts
 *   2. Add a payload type below
 *   3. Add a human-readable label in `event-labels.ts`
 *
 * Payload shapes are intentionally append-only. Renaming a field breaks the
 * timeline of every account that already stored events under the old shape.
 * Add a new field; deprecate the old one in code; never reshape historical
 * payloads.
 */
import type {
  DecisionRationaleCode,
  NegotiationLever,
  VendorEventKind,
} from "@server/infrastructure/db/schema";

export type SubscriptionCreatedPayload = {
  productName: string;
  planName: string | null;
  billingCycle: string;
  termStartDate: string;
  termEndDate: string;
  totalSeats: number;
  unitPriceCents: number;
  totalCostPerPeriodCents: number;
  autoRenew: boolean;
  noticePeriodDays: number;
};

export type SubscriptionUpdatedPayload = {
  changes: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
};

export type SubscriptionCancelledPayload = {
  productName: string;
  termEndDate: string;
};

export type ContractUploadedPayload = {
  documentId: string;
  filename: string;
  sizeBytes: number;
  pageCount: number | null;
};

export type ContractFieldAppliedPayload = {
  fieldKey: string;
  beforeValueJson: unknown;
  afterValueJson: unknown;
  documentId: string;
  evidenceQuote: string;
  evidencePageNumber: number | null;
  confidencePct: number;
};

export type RenewalDecisionLoggedPayload = {
  decision: string;
  rationaleCodes?: DecisionRationaleCode[];
  alternativesConsidered?: string | null;
  stakeholderUserIds?: string[];
  negotiationLever?: NegotiationLever;
  negotiationOutcomeSummary?: string | null;
  expectedAnnualSavingsUsdCents?: number | null;
  adjustedSeatCount?: number | null;
  adjustedUnitPriceCents?: number | null;
};

export type RenewalDecisionApprovedPayload = {
  decision: string;
  approvedByUserId: string;
};

export type RenewalDecisionRejectedPayload = {
  decision: string;
  rejectedByUserId: string;
};

export type SavingsRecordedPayload = {
  kind: string;
  baselineAnnualUsdCents: number;
  newAnnualUsdCents: number;
  savedAnnualUsdCents: number;
};

export type PriceChangedPayload = {
  beforeUnitPriceCents: number;
  afterUnitPriceCents: number;
  beforeTotalCostPerPeriodCents: number;
  afterTotalCostPerPeriodCents: number;
  /** Percentage delta of the per-period cost. Positive = increase. */
  deltaPct: number;
};

export type SeatCountChangedPayload = {
  beforeSeats: number;
  afterSeats: number;
  deltaSeats: number;
};

export type OwnerChangedPayload = {
  beforeOwnerUserId: string | null;
  afterOwnerUserId: string | null;
};

export type ComplianceDocReceivedPayload = {
  artifactKind: string;
  receivedAt: string;
  expiresAt: string | null;
  documentId: string | null;
};

export type ComplianceDocExpiredPayload = {
  artifactKind: string;
  expiresAt: string;
};

export type NoticeDeadlineMissedPayload = {
  noticeDeadline: string;
  productName: string;
  annualValueCents: number;
};

export type UserNoteAddedPayload = {
  note: string;
};

export type RenewalBriefGeneratedPayload = {
  recommendedAction: string;
  engine: string; // "deterministic" | "llm"
  confidencePct: number;
};

export type SavingsRealizedPayload = {
  projectedSavedAnnualUsdCents: number;
  realizedSavedAnnualUsdCents: number;
  status: string; // "realized" | "variance"
};

/**
 * Discriminated union keyed by kind. Lets the timeline UI switch on
 * `event.kind` and have TypeScript narrow `event.payload`.
 */
export type VendorEventPayloadByKind = {
  subscription_created: SubscriptionCreatedPayload;
  subscription_updated: SubscriptionUpdatedPayload;
  subscription_cancelled: SubscriptionCancelledPayload;
  contract_uploaded: ContractUploadedPayload;
  contract_field_applied: ContractFieldAppliedPayload;
  renewal_decision_logged: RenewalDecisionLoggedPayload;
  renewal_decision_approved: RenewalDecisionApprovedPayload;
  renewal_decision_rejected: RenewalDecisionRejectedPayload;
  savings_recorded: SavingsRecordedPayload;
  price_changed: PriceChangedPayload;
  seat_count_changed: SeatCountChangedPayload;
  owner_changed: OwnerChangedPayload;
  compliance_doc_received: ComplianceDocReceivedPayload;
  compliance_doc_expired: ComplianceDocExpiredPayload;
  notice_deadline_missed: NoticeDeadlineMissedPayload;
  user_note_added: UserNoteAddedPayload;
  renewal_brief_generated: RenewalBriefGeneratedPayload;
  savings_realized: SavingsRealizedPayload;
};

export type TypedVendorEvent<K extends VendorEventKind = VendorEventKind> = {
  kind: K;
  payload: VendorEventPayloadByKind[K];
};
