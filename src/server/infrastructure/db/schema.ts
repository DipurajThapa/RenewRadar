import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  date,
  uuid,
  jsonb,
  pgEnum,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const planTierEnum = pgEnum("plan_tier", [
  "free_forever",
  "starter",
  "growth",
  "pro",
  "enterprise",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "draft",
  "active",
  "paused",
  "pending_cancellation",
  "cancelled",
  "expired",
]);

export const billingCycleEnum = pgEnum("billing_cycle", [
  "monthly",
  "quarterly",
  "annual",
  "multi_year",
]);

export const renewalEventStatusEnum = pgEnum("renewal_event_status", [
  "upcoming",
  "notice_window",
  "action_needed",
  "processed",
  "missed",
]);

export const renewalDecisionEnum = pgEnum("renewal_decision", [
  "renewed",
  "renewed_with_adjustments",
  "downgraded",
  "cancelled",
  "deferred",
]);

export const renewalApprovalStatusEnum = pgEnum("renewal_approval_status", [
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "in_app",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "suppressed",
]);

export const savingsKindEnum = pgEnum("savings_kind", [
  "cancelled",
  "downgraded",
  "renegotiated",
  "avoided_increase",
]);

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const integrationKindEnum = pgEnum("integration_kind", [
  "slack_webhook",
  "ics_export",
]);

// ─── Phase C — Documents + AI extraction ────────────────────────────────────

export const documentKindEnum = pgEnum("document_kind", [
  "contract",
  "amendment",
  "invoice",
  "other",
]);

export const documentExtractionStatusEnum = pgEnum(
  "document_extraction_status",
  ["pending", "extracting", "ready", "failed"]
);

export const aiExtractionRunStatusEnum = pgEnum("ai_extraction_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const aiFieldKeyEnum = pgEnum("ai_field_key", [
  "renewal_date",
  "notice_period_days",
  "auto_renewal",
  "contract_value_cents",
  "price_increase_clause",
  "cancellation_method",
]);

export const aiFieldReviewStatusEnum = pgEnum("ai_field_review_status", [
  "pending",
  "accepted",
  "edited",
  "rejected",
  "applied",
]);

// ─── Vendor memory + decision intelligence ───────────────────────────────────

/**
 * Event-sourced vendor history. New event kinds added here are non-breaking
 * — old rows keep their original kind value, the type union just grows.
 */
export const vendorEventKindEnum = pgEnum("vendor_event_kind", [
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "contract_uploaded",
  "contract_field_applied",
  "renewal_decision_logged",
  "renewal_decision_approved",
  "renewal_decision_rejected",
  "savings_recorded",
  "price_changed",
  "seat_count_changed",
  "owner_changed",
  "compliance_doc_received",
  "compliance_doc_expired",
  "notice_deadline_missed",
  "user_note_added",
]);

/** Multi-select rationale codes captured at decide-now time. */
export const decisionRationaleCodeEnum = pgEnum("decision_rationale_code", [
  "cost_reduction",
  "low_usage",
  "poor_performance",
  "no_longer_needed",
  "found_alternative",
  "strategic_pivot",
  "security_concern",
  "compliance_concern",
  "consolidation",
  "team_change",
  "vendor_acquired",
  "price_too_high",
  "missing_features",
  "support_issues",
]);

/** Lever the user pulled in the negotiation, if any. */
export const negotiationLeverEnum = pgEnum("negotiation_lever", [
  "none",
  "multi_year_commit",
  "payment_terms",
  "volume_increase",
  "competing_quote",
  "executive_escalation",
  "consolidated_with_other_products",
  "threatened_cancellation",
  "other",
]);

/** Kinds of compliance documents we track per vendor. */
export const complianceArtifactKindEnum = pgEnum("compliance_artifact_kind", [
  "dpa",
  "msa",
  "nda",
  "soc2_type_ii_report",
  "soc2_type_i_report",
  "iso_27001",
  "iso_27018",
  "iso_27701",
  "hipaa_baa",
  "pci_aoc",
  "gdpr_addendum",
  "insurance_certificate",
  "w9",
  "w8_ben_e",
  "vendor_security_questionnaire",
  "subprocessor_list",
  "penetration_test_summary",
  "incident_response_plan",
  "other",
]);

export const notificationTriggerEnum = pgEnum("notification_trigger", [
  "notice_window_30",
  "notice_window_14",
  "notice_window_7",
  "notice_window_3",
  "notice_window_1",
  "notice_window_missed",
  "renewal_90",
  "renewal_60",
  "renewal_30",
  "renewal_14",
  "renewal_7",
  "renewal_1",
  "weekly_digest",
  "monthly_summary",
  "decision_confirmation",
  "welcome",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

export const accountsTable = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  billingEmail: text("billing_email").notNull(),
  planTier: planTierEnum("plan_tier").notNull().default("free_forever"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialExpiresAt: timestamp("trial_expires_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  /** When true, renewal decisions require a separate admin/owner approval
   *  before the decision is treated as final by alerts, queues, and reports. */
  requireApprovals: boolean("require_approvals").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export const usersTable = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    workEmail: text("work_email").notNull(),
    fullName: text("full_name"),
    role: userRoleEnum("role").notNull().default("owner"),
    notificationPrefs: jsonb("notification_prefs")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => ({
    accountEmailUnique: unique().on(t.accountId, t.workEmail),
    accountIdx: index("user_account_idx").on(t.accountId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Vendors (per-account in V1)
// ─────────────────────────────────────────────────────────────────────────────

export const vendorsTable = pgTable(
  "vendor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    cancellationUrl: text("cancellation_url"),
    cancellationEmail: text("cancellation_email"),
    cancellationPhone: text("cancellation_phone"),
    cancellationNotes: text("cancellation_notes"),
    accountManagerName: text("account_manager_name"),
    accountManagerEmail: text("account_manager_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountIdx: index("vendor_account_idx").on(t.accountId),
    accountNameUnique: unique().on(t.accountId, t.name),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionsTable = pgTable(
  "subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    planName: text("plan_name"),
    billingCycle: billingCycleEnum("billing_cycle").notNull(),
    termStartDate: date("term_start_date").notNull(),
    termEndDate: date("term_end_date").notNull(),
    autoRenew: boolean("auto_renew").notNull().default(true),
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    totalSeats: integer("total_seats").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCostPerPeriodCents: integer("total_cost_per_period_cents").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountIdx: index("subscription_account_idx").on(t.accountId),
    accountStatusIdx: index("subscription_account_status_idx").on(
      t.accountId,
      t.status
    ),
    accountTermEndIdx: index("subscription_account_term_end_idx").on(
      t.accountId,
      t.termEndDate
    ),
    vendorIdx: index("subscription_vendor_idx").on(t.vendorId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Renewal Events
// ─────────────────────────────────────────────────────────────────────────────

export const renewalEventsTable = pgTable(
  "renewal_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    renewalDate: date("renewal_date").notNull(),
    noticeDeadline: date("notice_deadline").notNull(),
    status: renewalEventStatusEnum("status").notNull().default("upcoming"),
    decision: renewalDecisionEnum("decision"),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    decisionNote: text("decision_note"),
    adjustedSeatCount: integer("adjusted_seat_count"),
    adjustedUnitPriceCents: integer("adjusted_unit_price_cents"),
    /** Approvals-lite: filled in when account.requireApprovals is on. The
     *  decider records the decision; a different admin/owner approves it. */
    approvalStatus: renewalApprovalStatusEnum("approval_status")
      .notNull()
      .default("not_required"),
    approvedByUserId: uuid("approved_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    subscriptionIdx: index("renewal_event_subscription_idx").on(
      t.subscriptionId
    ),
    accountNoticeIdx: index("renewal_event_account_notice_idx").on(
      t.accountId,
      t.noticeDeadline
    ),
    accountRenewalIdx: index("renewal_event_account_renewal_idx").on(
      t.accountId,
      t.renewalDate
    ),
    accountApprovalIdx: index("renewal_event_account_approval_idx").on(
      t.accountId,
      t.approvalStatus
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notificationsTable = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    trigger: notificationTriggerEnum("trigger").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    status: notificationStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Dedup at the (user, trigger, entity, channel) grain so we can fan out
    // the same trigger to both email and in-app while still preventing
    // duplicate sends within a single channel.
    dedupeIdx: unique("notification_dedupe").on(
      t.userId,
      t.trigger,
      t.entityType,
      t.entityId,
      t.channel
    ),
    accountIdx: index("notification_account_idx").on(t.accountId),
    userStatusIdx: index("notification_user_status_idx").on(t.userId, t.status),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Savings Records
// ─────────────────────────────────────────────────────────────────────────────

export const savingsRecordsTable = pgTable(
  "savings_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    renewalEventId: uuid("renewal_event_id")
      .notNull()
      .references(() => renewalEventsTable.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
    kind: savingsKindEnum("kind").notNull(),
    baselineAnnualUsdCents: integer("baseline_annual_usd_cents").notNull(),
    newAnnualUsdCents: integer("new_annual_usd_cents").notNull(),
    savedAnnualUsdCents: integer("saved_annual_usd_cents").notNull(),
    note: text("note"),
    /** Once non-null, the row is immutable. Auto-set 30 days after createdAt. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountIdx: index("savings_record_account_idx").on(t.accountId),
    accountCreatedIdx: index("savings_record_account_created_idx").on(
      t.accountId,
      t.createdAt
    ),
    /** One savings row per renewal event — re-running the decision updates the
     *  existing row rather than stacking. */
    renewalEventUnique: unique("savings_record_renewal_event_unique").on(
      t.renewalEventId
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Integrations (per-account, one row per kind)
// ─────────────────────────────────────────────────────────────────────────────

export const integrationsTable = pgTable(
  "integration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    kind: integrationKindEnum("kind").notNull(),
    /** Encrypted config blob — for slack_webhook this is `{ webhookUrl }`; for
     *  ics_export it's `{ token }`. We encrypt at write time via lib/crypto. */
    configCiphertext: text("config_ciphertext").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountKindUnique: unique("integration_account_kind_unique").on(
      t.accountId,
      t.kind
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────────────────────

export const invitationsTable = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull().default("member"),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Random token presented in the accept link; revoked when nulled. */
    token: text("token").notNull().unique(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountEmailUnique: unique("invitation_account_email_unique").on(
      t.accountId,
      t.email
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Documents — uploaded contracts, amendments, invoices
// ─────────────────────────────────────────────────────────────────────────────

export const documentsTable = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** Optional link to the subscription this document supports. */
    subscriptionId: uuid("subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    uploadedByUserId: uuid("uploaded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    kind: documentKindEnum("kind").notNull().default("contract"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Storage key — provider-agnostic. Local FS today, R2 tomorrow. */
    storageKey: text("storage_key").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    pageCount: integer("page_count"),
    textExtractionStatus: documentExtractionStatusEnum(
      "text_extraction_status"
    )
      .notNull()
      .default("pending"),
    /** Plain text. Null until OCR/text-extract completes. */
    textContent: text("text_content"),
    textExtractionError: text("text_extraction_error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("document_account_idx").on(t.accountId),
    subscriptionIdx: index("document_subscription_idx").on(t.subscriptionId),
    accountUploadedIdx: index("document_account_uploaded_idx").on(
      t.accountId,
      t.uploadedAt
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AI Extraction Run — one row per extraction attempt against a document
// ─────────────────────────────────────────────────────────────────────────────

export const aiExtractionRunsTable = pgTable(
  "ai_extraction_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: aiExtractionRunStatusEnum("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    /** Cost in micro-USD (1/1,000,000 of a dollar) so we can sum precisely. */
    costUsdMicros: integer("cost_usd_micros"),
    /** Pages charged to the account's monthly budget. */
    pagesCharged: integer("pages_charged"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    accountIdx: index("ai_extraction_run_account_idx").on(t.accountId),
    documentIdx: index("ai_extraction_run_document_idx").on(t.documentId),
    accountStartedIdx: index("ai_extraction_run_account_started_idx").on(
      t.accountId,
      t.startedAt
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// AI Extracted Field — one row per field per run, the unit of human review
// ─────────────────────────────────────────────────────────────────────────────

export const aiExtractedFieldsTable = pgTable(
  "ai_extracted_field",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiExtractionRunsTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    /** Where the approved field will be applied. Required for review. */
    subscriptionId: uuid("subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    fieldKey: aiFieldKeyEnum("field_key").notNull(),
    /** The raw value the provider returned, as a string. */
    rawValue: text("raw_value"),
    /** Typed value as JSON ({"date":"2026-12-31"}, {"days":30}, {"yes":true}, ...). */
    parsedValueJson: jsonb("parsed_value_json"),
    /** 0..1 confidence. Always populated. */
    confidence: integer("confidence_pct").notNull(),
    /** Verbatim quote from the source document. REQUIRED by binding principle 4. */
    evidenceQuote: text("evidence_quote").notNull(),
    evidencePageNumber: integer("evidence_page_number"),
    reviewStatus: aiFieldReviewStatusEnum("review_status")
      .notNull()
      .default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Populated when reviewStatus = "edited" — the value the human chose. */
    reviewerEditedValueJson: jsonb("reviewer_edited_value_json"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("ai_extracted_field_account_idx").on(t.accountId),
    runIdx: index("ai_extracted_field_run_idx").on(t.runId),
    accountStatusIdx: index("ai_extracted_field_account_status_idx").on(
      t.accountId,
      t.reviewStatus
    ),
    subscriptionIdx: index("ai_extracted_field_subscription_idx").on(
      t.subscriptionId
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Event — immutable per-vendor timeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only log of every significant moment in the relationship with a
 * vendor. Survives years of team turnover; lets future operators answer
 * "what happened with this vendor over time?"
 *
 * Distinct from `audit_log`: the audit log is for security review (who
 * mutated what row). Vendor events are for business memory (what happened
 * in our relationship with this vendor, derivable into intelligence).
 *
 * Rule: never UPDATE or DELETE these rows. Append only.
 */
export const vendorEventsTable = pgTable(
  "vendor_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    kind: vendorEventKindEnum("kind").notNull(),
    payload: jsonb("payload").notNull(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountVendorOccurredIdx: index(
      "vendor_event_account_vendor_occurred_idx"
    ).on(t.accountId, t.vendorId, t.occurredAt),
    accountKindIdx: index("vendor_event_account_kind_idx").on(
      t.accountId,
      t.kind
    ),
    subscriptionIdx: index("vendor_event_subscription_idx").on(
      t.subscriptionId
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Decision Context — structured rationale captured at decide-now time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per renewal_event that has had a decision logged with the
 * enhanced rationale UI. Older renewal events without a context row keep
 * working — the timeline just doesn't have the rich "why" for those.
 */
export const decisionContextsTable = pgTable(
  "decision_context",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    renewalEventId: uuid("renewal_event_id")
      .notNull()
      .references(() => renewalEventsTable.id, { onDelete: "cascade" })
      .unique(),
    /** Multi-select rationale codes. JSON array of decision_rationale_code values. */
    rationaleCodesJson: jsonb("rationale_codes_json").notNull(),
    alternativesConsidered: text("alternatives_considered"),
    /** JSON array of user UUIDs from the same account. */
    stakeholdersConsultedJson: jsonb("stakeholders_consulted_json"),
    negotiationLever: negotiationLeverEnum("negotiation_lever")
      .notNull()
      .default("none"),
    negotiationOutcomeSummary: text("negotiation_outcome_summary"),
    expectedAnnualSavingsUsdCents: integer("expected_annual_savings_usd_cents"),
    expectedSavingsRealizedAt: timestamp("expected_savings_realized_at", {
      withTimezone: true,
    }),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountRenewalUnique: unique("decision_context_account_renewal_unique").on(
      t.accountId,
      t.renewalEventId
    ),
    accountIdx: index("decision_context_account_idx").on(t.accountId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Artifact — record-keeping for legal / security documents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Track which legal and security documents are on file for each vendor.
 * NOT legal review or risk scoring — this is record-keeping.
 */
export const complianceArtifactsTable = pgTable(
  "compliance_artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    kind: complianceArtifactKindEnum("kind").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    documentId: uuid("document_id").references(() => documentsTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountVendorIdx: index("compliance_artifact_account_vendor_idx").on(
      t.accountId,
      t.vendorId
    ),
    accountExpiresIdx: index("compliance_artifact_account_expires_idx").on(
      t.accountId,
      t.expiresAt
    ),
    accountVendorKindUnique: unique(
      "compliance_artifact_account_vendor_kind_unique"
    ).on(t.accountId, t.vendorId, t.kind),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log (write-only in V1)
// ─────────────────────────────────────────────────────────────────────────────

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetEntityType: text("target_entity_type"),
    targetEntityId: uuid("target_entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountCreatedIdx: index("audit_log_account_created_idx").on(
      t.accountId,
      t.createdAt
    ),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────

export const accountsRelations = relations(accountsTable, ({ many }) => ({
  users: many(usersTable),
  vendors: many(vendorsTable),
  subscriptions: many(subscriptionsTable),
  renewalEvents: many(renewalEventsTable),
  notifications: many(notificationsTable),
  auditLog: many(auditLogTable),
}));

export const usersRelations = relations(usersTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [usersTable.accountId],
    references: [accountsTable.id],
  }),
  notifications: many(notificationsTable),
  ownedSubscriptions: many(subscriptionsTable),
}));

export const vendorsRelations = relations(vendorsTable, ({ one, many }) => ({
  account: one(accountsTable, {
    fields: [vendorsTable.accountId],
    references: [accountsTable.id],
  }),
  subscriptions: many(subscriptionsTable),
}));

export const subscriptionsRelations = relations(
  subscriptionsTable,
  ({ one, many }) => ({
    account: one(accountsTable, {
      fields: [subscriptionsTable.accountId],
      references: [accountsTable.id],
    }),
    vendor: one(vendorsTable, {
      fields: [subscriptionsTable.vendorId],
      references: [vendorsTable.id],
    }),
    owner: one(usersTable, {
      fields: [subscriptionsTable.ownerUserId],
      references: [usersTable.id],
    }),
    renewalEvents: many(renewalEventsTable),
  })
);

export const renewalEventsRelations = relations(
  renewalEventsTable,
  ({ one }) => ({
    subscription: one(subscriptionsTable, {
      fields: [renewalEventsTable.subscriptionId],
      references: [subscriptionsTable.id],
    }),
    account: one(accountsTable, {
      fields: [renewalEventsTable.accountId],
      references: [accountsTable.id],
    }),
    decidedBy: one(usersTable, {
      fields: [renewalEventsTable.decidedByUserId],
      references: [usersTable.id],
    }),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Type exports
// ─────────────────────────────────────────────────────────────────────────────

export type Account = typeof accountsTable.$inferSelect;
export type NewAccount = typeof accountsTable.$inferInsert;

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;

export type Vendor = typeof vendorsTable.$inferSelect;
export type NewVendor = typeof vendorsTable.$inferInsert;

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type NewSubscription = typeof subscriptionsTable.$inferInsert;

export type RenewalEvent = typeof renewalEventsTable.$inferSelect;
export type NewRenewalEvent = typeof renewalEventsTable.$inferInsert;

export type Notification = typeof notificationsTable.$inferSelect;
export type NewNotification = typeof notificationsTable.$inferInsert;

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
export type NewAuditLogEntry = typeof auditLogTable.$inferInsert;

export type SavingsRecord = typeof savingsRecordsTable.$inferSelect;
export type NewSavingsRecord = typeof savingsRecordsTable.$inferInsert;

export type Integration = typeof integrationsTable.$inferSelect;
export type NewIntegration = typeof integrationsTable.$inferInsert;

export type Invitation = typeof invitationsTable.$inferSelect;
export type NewInvitation = typeof invitationsTable.$inferInsert;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type SavingsKind = (typeof savingsKindEnum.enumValues)[number];
export type IntegrationKind = (typeof integrationKindEnum.enumValues)[number];

export type Document = typeof documentsTable.$inferSelect;
export type NewDocument = typeof documentsTable.$inferInsert;
export type DocumentKind = (typeof documentKindEnum.enumValues)[number];
export type DocumentExtractionStatus =
  (typeof documentExtractionStatusEnum.enumValues)[number];

export type AiExtractionRun = typeof aiExtractionRunsTable.$inferSelect;
export type NewAiExtractionRun = typeof aiExtractionRunsTable.$inferInsert;
export type AiExtractionRunStatus =
  (typeof aiExtractionRunStatusEnum.enumValues)[number];

export type AiExtractedField = typeof aiExtractedFieldsTable.$inferSelect;
export type NewAiExtractedField = typeof aiExtractedFieldsTable.$inferInsert;
export type AiFieldKey = (typeof aiFieldKeyEnum.enumValues)[number];
export type AiFieldReviewStatus =
  (typeof aiFieldReviewStatusEnum.enumValues)[number];

export type VendorEvent = typeof vendorEventsTable.$inferSelect;
export type NewVendorEvent = typeof vendorEventsTable.$inferInsert;
export type VendorEventKind = (typeof vendorEventKindEnum.enumValues)[number];

export type DecisionContext = typeof decisionContextsTable.$inferSelect;
export type NewDecisionContext = typeof decisionContextsTable.$inferInsert;
export type DecisionRationaleCode =
  (typeof decisionRationaleCodeEnum.enumValues)[number];
export type NegotiationLever =
  (typeof negotiationLeverEnum.enumValues)[number];

export type ComplianceArtifact = typeof complianceArtifactsTable.$inferSelect;
export type NewComplianceArtifact =
  typeof complianceArtifactsTable.$inferInsert;
export type ComplianceArtifactKind =
  (typeof complianceArtifactKindEnum.enumValues)[number];
