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
  uniqueIndex,
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
  // A one-time obligation that simply expires (a perpetual license, a cert, a
  // government notice) — no recurring cadence.
  "one_time",
]);

/**
 * AI-first generalization: the `subscription` row is the universal "renewal
 * item." `category` is the single discriminator that lets one engine
 * (renewal_event + brief + agent + alerts + audit) serve every obligation type
 * — SaaS, licenses, contracts, insurance, compliance certs, government notices,
 * domains, warranties, memberships, personal items — with NO parallel table.
 * Defaults to `saas_subscription` so every existing row is non-breaking.
 */
export const renewalItemCategoryEnum = pgEnum("renewal_item_category", [
  "saas_subscription",
  "software_license",
  "contract",
  "vendor_agreement",
  "insurance_policy",
  "compliance_cert",
  "government_notice",
  "domain_dns",
  "warranty_amc",
  "professional_membership",
  "personal_item",
  "other",
]);
export type RenewalItemCategory =
  (typeof renewalItemCategoryEnum.enumValues)[number];

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
  // AI-first generalization — obligation document types beyond SaaS contracts.
  "license",
  "certificate",
  "policy",
  "notice",
  "statement",
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
  // AI-first generalization — obligation-generic extracted fields. `expiry_date`
  // maps to termEndDate (same apply path as renewal_date); `issuer` and
  // `reference_number` land in attributesJson (no column-per-field).
  "expiry_date",
  "issuer",
  "reference_number",
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
  // Wedge PoC — a Renewal Intelligence Brief was generated for this vendor's sub.
  "renewal_brief_generated",
  // A2 — a projected saving was reconciled against actual post-renewal spend.
  "savings_realized",
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
  // T4.11 — procurement intake. `submitted` fans out to approvers
  // (owners + admins); `decided` notifies the original requester of the
  // approve / deny / duplicate outcome.
  "intake_request_submitted",
  "intake_request_decided",
  // T4.10 Slice 4 — a connected vendor published an announcement
  // (price change / renewal reminder / EOL / general) to this customer.
  "vendor_announcement",
  // A compliance artifact (DPA / SOC 2 / insurance cert / …) with a recorded
  // `expiresAt` is approaching its expiry. Raised once per artifact by the
  // daily deadline-alert cron so a lapsing document doesn't slip silently.
  "compliance_doc_expiring",
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
  /**
   * When the Stripe subscription first entered `past_due`. Cleared the moment
   * it returns to `active`/`trialing`. The grace cron uses this to decide
   * when to force-downgrade an account that's been past-due too long — the
   * prior behaviour was an unbounded grace period that let unpaid
   * customers ride a paid tier indefinitely (audit H3).
   */
  pastDueSince: timestamp("past_due_since", { withTimezone: true }),
  /**
   * Soft write-lock for over-capacity accounts after a tier downgrade.
   *
   *   null            — normal account, writes allowed
   *   over_capacity   — writes refused with an "upgrade or clean up"
   *                     error. Reads (including export) still work so
   *                     the customer can decide what to delete.
   *
   * Set by the Stripe webhook when a downgrade leaves the account over
   * the new cap (e.g., Pro→Starter with 500 subs vs 50 cap). Cleared
   * automatically when the account is back under the cap on the next
   * write attempt.
   */
  lockState: text("lock_state"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  /** When true, renewal decisions require a separate admin/owner approval
   *  before the decision is treated as final by alerts, queues, and reports. */
  requireApprovals: boolean("require_approvals").notNull().default(false),
  /** Kill-switch for the autonomous Renewal Agent. When true (default), the
   *  agent proactively pre-preps renewals (brief + internal notice) as they
   *  enter their notice window. Auto-prep is internal + reversible + audited;
   *  this lets an operator turn the autonomy off per account. */
  agentAutoPrep: boolean("agent_auto_prep").notNull().default(true),
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
    /**
     * Soft-delete marker. Set when the Clerk webhook delivers user.deleted;
     * row is kept so historical audit-log entries referencing this user
     * keep their foreign key + the team can see who took past actions
     * (audit H1 — hard delete erased lineage).
     *
     * Queries that surface "active" team members MUST filter on
     * `isNull(deletedAt)`. The seat-count enforcement does this already.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    accountEmailUnique: unique().on(t.accountId, t.workEmail),
    accountIdx: index("user_account_idx").on(t.accountId),
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// User archive — the "never delete users" graveyard (P7.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Binding principle: a user row is NEVER deleted from the database. When a
// user is removed (Clerk webhook user.deleted, account closure, admin
// removal, GDPR erasure request) the row moves to `user_archive`. Reasons:
//
//   1. Audit lineage. Every audit_log row references actor_user_id. If we
//      drop the user row, the audit history becomes "<deleted user> did X"
//      forever — useless for forensics or compliance reconstruction.
//
//   2. Re-signup detection. If the same person re-signs up (different
//      Clerk identity, same work email), we can match against the archive
//      and either restore the original account membership or surface a
//      "welcome back" path with their old preferences.
//
//   3. Churn analytics + GDPR audit. Regulators ask "who, when, why."
//      Hard delete erases the evidence we ever processed the data.
//
// The shape mirrors `users` so the move is a structural copy plus four
// archival metadata fields. We DO NOT FK to accounts here — when an
// account is later removed, its archived users stay archived; the FK
// from audit_log to user IS preserved because the original UUID is the
// same in both tables (archived row keeps its original id).
export const usersArchiveTable = pgTable(
  "user_archive",
  {
    /**
     * Same UUID as the original users.id. We keep it so historical FK
     * references in audit_log etc. remain meaningful. The original row
     * is removed from `user` so general queries don't see it.
     */
    id: uuid("id").primaryKey(),
    /** Original account membership — not an FK (accounts may later vanish too). */
    accountId: uuid("account_id").notNull(),
    /** Clerk identity at the time of archiving. Useful for re-signup match. */
    clerkUserId: text("clerk_user_id").notNull(),
    workEmail: text("work_email").notNull(),
    fullName: text("full_name"),
    role: userRoleEnum("role").notNull(),
    notificationPrefs: jsonb("notification_prefs").notNull(),
    originalCreatedAt: timestamp("original_created_at", {
      withTimezone: true,
    }).notNull(),
    originalLastLoginAt: timestamp("original_last_login_at", {
      withTimezone: true,
    }),

    // ─── Archival metadata ──────────────────────────────────────────
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Why this row was archived. Free-text but the application uses a
     * small enumerable set: "clerk_user_deleted", "admin_removed",
     * "account_closed", "gdpr_erasure_request", "test_cleanup".
     */
    archivedReason: text("archived_reason").notNull(),
    /** Whoever initiated the archive (admin user) — null for system events. */
    archivedByUserId: uuid("archived_by_user_id"),
    /**
     * Free-text note from the archiver. Used by GDPR-style erasure
     * requests where the operator records the ticket / legal basis.
     */
    archivedNote: text("archived_note"),
  },
  (t) => ({
    archiveAccountIdx: index("user_archive_account_idx").on(t.accountId),
    archiveEmailIdx: index("user_archive_email_idx").on(t.workEmail),
    archiveClerkIdx: index("user_archive_clerk_idx").on(t.clerkUserId),
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
    /**
     * The obligation type. `vendor` generalizes to the "party / issuer" (an
     * insurer, a government body, a certifying authority), so every category
     * still has a counterparty row and every existing vendor join keeps working.
     */
    category: renewalItemCategoryEnum("category")
      .notNull()
      .default("saas_subscription"),
    /**
     * Type-specific long tail (policy number, jurisdiction, certifying body,
     * license seat-pool, reference number) so insurance/license/cert specifics
     * don't each need their own column. Mirrors the existing briefJson /
     * notificationPrefs jsonb pattern.
     */
    attributesJson: jsonb("attributes_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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
    /**
     * First-class extraction outputs (promoted from notes blob).
     *
     * `cancellationMethodCode` — one of the values in the
     * `cancellation_method` enum at apply-field.ts line 294. Indexed for
     * "show me all the contracts that need a written notice" queries.
     *
     * `priceIncreaseClauseText` — verbatim clause text from the AI
     * extractor. Storing the structured text (not just a boolean) keeps
     * the renewal owner's decision context complete without grep-ing
     * notes blobs.
     */
    cancellationMethodCode: text("cancellation_method_code"),
    priceIncreaseClauseText: text("price_increase_clause_text"),
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
    /** Once non-null, the row is immutable. Auto-set 30 days after createdAt.
     *  NOTE: the lock protects the PROJECTED columns; the realized-* columns
     *  below are filled additively by reconciliation even on a locked row. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // ── Projected → realized reconciliation (A2 — the ROI loop) ──────────────
    /** When the new price should be observable: termEndDate + one billing cycle.
     *  The reconciliation cron picks up rows whose date has passed + reconciledAt
     *  is null. Nullable — historical rows created before A2 have no anchor. */
    expectedSavingsRealizedAt: timestamp("expected_savings_realized_at", {
      withTimezone: true,
    }),
    /** Actual annualized post-renewal cost, from the spend feed. */
    realizedNewAnnualUsdCents: integer("realized_new_annual_usd_cents"),
    /** baseline − realizedNew (clamped ≥ 0). The PROVEN saving. */
    realizedSavedAnnualUsdCents: integer("realized_saved_annual_usd_cents"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    /** null = pending; 'realized' (matches projection) | 'variance' (differs) |
     *  'not_observed' (no post-renewal charge seen yet). */
    reconciliationStatus: text("reconciliation_status"),
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
    /**
     * SHA-256 hex of the public-lookup secret (currently only ICS tokens
     * populate this). Indexed so `/api/calendar/[token].ics` resolves in
     * O(1) by hash instead of decrypting every account's row with scrypt —
     * the prior pattern was a CPU-exhaustion DoS vector. Null for kinds
     * with no public lookup path (e.g. slack_webhook).
     */
    tokenLookupHash: text("token_lookup_hash"),
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
    tokenLookupHashIdx: index("integration_token_lookup_hash_idx").on(
      t.tokenLookupHash
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
// AI Reasoning Usage — one row per metered LLM reasoning op (brief / Ask). The
// reasoning analog of ai_extraction_run.pagesCharged: the ledger the per-account
// monthly spend cap (F3) sums over. Local inference is free, but each row carries
// the hosted-equivalent cost so the cap is meaningful on a served deployment.
// ─────────────────────────────────────────────────────────────────────────────

export const aiReasoningUsageTable = pgTable(
  "ai_reasoning_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** "brief" | "ask" — which reasoning surface produced the call. */
    surface: text("surface").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Hosted-equivalent cost in micro-USD (1/1,000,000 $) so sums are exact. */
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountCreatedIdx: index("ai_reasoning_usage_account_created_idx").on(
      t.accountId,
      t.createdAt
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
    /** 0..100 integer confidence (column confidence_pct). Always populated. */
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
// Marketing leads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inbound lead capture from public forms (home hero, enterprise CTA, security
 * newsletter, blog post footer). Unlike every other table in this schema, a
 * lead is pre-account — there's no `accountId` because the visitor hasn't
 * signed up yet.
 *
 *   - `email` is unique to debounce repeat submissions. A second submission
 *     with the same email updates the row (newer fields win) rather than
 *     creating a duplicate; the use case handles the upsert.
 *   - `source` records where the form was submitted from. Free text so we
 *     can drop forms anywhere without a schema migration; the lead-capture
 *     application module owns the canonical source list.
 *   - `intent` is a narrow taxonomy ("demo" / "enterprise" / "newsletter" /
 *     "other"). The marketing team uses it to route follow-ups.
 *   - `metadataJson` is a catch-all for non-PII signals: UTM parameters,
 *     referrer, screen size. Never store secrets here — it's surfaced in
 *     CRM exports.
 *   - `consentMarketing` records explicit consent for marketing email.
 *     Required for GDPR — if false, the lead can only be contacted in
 *     response to their specific inquiry.
 */
export const leadsTable = pgTable(
  "lead",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    company: text("company"),
    jobTitle: text("job_title"),
    source: text("source").notNull(),
    intent: text("intent").notNull().default("other"),
    message: text("message"),
    status: text("status").notNull().default("new"),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    metadataJson: jsonb("metadata_json"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: unique("lead_email_unique").on(t.email),
    statusCreatedIdx: index("lead_status_created_idx").on(
      t.status,
      t.createdAt
    ),
  })
);
export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Import Batch — one row per CSV/spreadsheet import commit. Lets the user undo
// a recent import within 24h (T4.15). Stores the created subscription IDs as
// JSONB so the undo path can soft-delete exactly the rows the batch produced
// (not a "delete everything from the same minute" heuristic that would lose
// rows the user added in between).
// ─────────────────────────────────────────────────────────────────────────────

export const importBatchesTable = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /**
     * Free-text describing where the import came from — "csv" for the CSV
     * import dialog, others reserved for future intake methods (email
     * forwarding, inbox connector). Helps the activity log read naturally.
     */
    source: text("source").notNull().default("csv"),
    /** UUIDs of subscriptions this import created. */
    subscriptionIdsJson: jsonb("subscription_ids_json")
      .$type<string[]>()
      .notNull(),
    /** When the undo ran. Null = batch is still undoable (within the window). */
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByUserId: uuid("undone_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountCreatedIdx: index("import_batch_account_created_idx").on(
      t.accountId,
      t.createdAt
    ),
  })
);
export type ImportBatch = typeof importBatchesTable.$inferSelect;
export type NewImportBatch = typeof importBatchesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// T4.1 — Staff identity + support sessions (concierge onboarding).
//
// `staff_user` is the identity table for Renewal Radar operators who run
// support / concierge sessions on behalf of customers. It is DELIBERATELY
// SEPARATE from `users` so a staff member can never appear as a customer
// (and vice versa). Auto-provisioned on first auth when the staff member's
// Clerk email matches the `STAFF_EMAILS` env-var allowlist; in DEMO_MODE a
// fixed staff user is seeded.
//
// `support_session` is the per-incident record: which staff member, on
// which customer account, for what reason, when it started, when it ends.
// Default expiry is 4 hours. Every mutation performed during a session
// references the session id in the audit-log `after` blob so a customer
// can reconstruct "who touched my data and why."
// ─────────────────────────────────────────────────────────────────────────────

export const staffRoleEnum = pgEnum("staff_role", [
  "viewer", // read-only across customers
  "support", // read + on-behalf actions
  "admin", // support + manage other staff
]);

export const staffUsersTable = pgTable(
  "staff_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Auth identity from Clerk. Nullable while the user hasn't completed first auth. */
    clerkUserId: text("clerk_user_id"),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: staffRoleEnum("role").notNull().default("support"),
    /** Flip false to revoke without deleting (preserves audit-log FKs). */
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: unique("staff_user_email_unique").on(t.email),
    clerkIdIdx: index("staff_user_clerk_id_idx").on(t.clerkUserId),
  })
);
export type StaffUser = typeof staffUsersTable.$inferSelect;
export type NewStaffUser = typeof staffUsersTable.$inferInsert;

export const supportSessionEndReasonEnum = pgEnum(
  "support_session_end_reason",
  ["manual", "timeout", "superseded"]
);

export const supportSessionsTable = pgTable(
  "support_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsersTable.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** Free-text justification — required at session start. Surfaced to the customer. */
    reason: text("reason").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: supportSessionEndReasonEnum("ended_reason"),
    /** Count of customer-visible mutations made during the session (audit hint). */
    mutationCount: integer("mutation_count").notNull().default(0),
  },
  (t) => ({
    staffActiveIdx: index("support_session_staff_active_idx").on(
      t.staffUserId,
      t.endedAt
    ),
    accountStartedIdx: index("support_session_account_started_idx").on(
      t.accountId,
      t.startedAt
    ),
  })
);
export type SupportSession = typeof supportSessionsTable.$inferSelect;
export type NewSupportSession = typeof supportSessionsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// T4.6 — Public API keys.
//
// Each row is one issued API key. We store the SHA-256 hash of the full
// secret; the raw key value is shown to the user EXACTLY ONCE at creation
// time and never again. Lookup goes prefix → hash → equality check.
//
// Format: `rr_pk_<32 hex chars>` (~40 chars total). Prefix `rr_pk_` makes
// secret scanners (GitHub, etc.) detect leaked keys; the indexed
// `keyPrefix` column stores the first 8 hex chars after the literal prefix
// so we can find a candidate row before paying for the hash compare.
//
// Scopes are an enum stored as text[] for forward compatibility — adding
// a new scope (e.g. `documents:write`) requires no migration.
//
// Soft-revoke via `revokedAt` — never hard-delete so the audit trail of
// "what did this key do" stays intact.
// ─────────────────────────────────────────────────────────────────────────────

export const apiKeysTable = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** Display name set by the user — e.g. "Production backend". */
    name: text("name").notNull(),
    /**
     * First 8 hex chars after the `rr_pk_` literal prefix. Indexed so the
     * verify path is one SELECT, not a full-table scan.
     */
    keyPrefix: text("key_prefix").notNull(),
    /** SHA-256 hex of the full raw key string. */
    keyHash: text("key_hash").notNull(),
    /** Permissions granted to this key. Each entry from API_KEY_SCOPES. */
    scopesJson: jsonb("scopes_json").$type<string[]>().notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountIdx: index("api_key_account_idx").on(t.accountId),
    /** Lookup hint — paired with the hash equality check. */
    prefixHashIdx: index("api_key_prefix_hash_idx").on(t.keyPrefix, t.keyHash),
  })
);
export type ApiKey = typeof apiKeysTable.$inferSelect;
export type NewApiKey = typeof apiKeysTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// T4.11 — Procurement intake requests.
//
// An employee submits "I want to start paying for X." A procurement/owner
// reviews and approves, denies, or marks duplicate.
//
//   - `approved` → a draft subscription is created and linked via
//     `createdSubscriptionId`. The customer finishes the contract details
//     later through the regular subscription edit flow.
//   - `duplicate` → linked to the existing matching subscription via
//     `linkedExistingSubscriptionId` so the requester sees "we already
//     have Slack, here's the page."
//   - `withdrawn` → requester pulled it back before review.
//   - `denied` → reviewer rejected with a reason captured in
//     `reviewerNote` so the requester learns why.
//
// Status transitions are one-way out of `pending`. A denied or withdrawn
// request can't be re-opened — submit a fresh one. This keeps the audit
// chain clean.
// ─────────────────────────────────────────────────────────────────────────────

export const intakeRequestStatusEnum = pgEnum("intake_request_status", [
  "pending",
  "approved",
  "denied",
  "duplicate",
  "withdrawn",
]);

export const intakeRequestsTable = pgTable(
  "intake_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    vendor: text("vendor").notNull(),
    product: text("product").notNull(),
    /** Optional plan tier the requester thinks they need ("Pro", "Team", etc.) */
    planNotes: text("plan_notes"),
    /** Required free-text "why" — the reviewer's input for approve/deny. */
    businessCase: text("business_case").notNull(),
    estimatedAnnualUsdCents: integer("estimated_annual_usd_cents").notNull(),
    /** Optional: when the requester wants to start using it. */
    expectedStartDate: date("expected_start_date"),
    status: intakeRequestStatusEnum("status").notNull().default("pending"),
    reviewerUserId: uuid("reviewer_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewerNote: text("reviewer_note"),
    /** Set when status=approved — the draft subscription we created. */
    createdSubscriptionId: uuid("created_subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    /** Set when status=duplicate — the existing subscription it matches. */
    linkedExistingSubscriptionId: uuid("linked_existing_subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountStatusIdx: index("intake_request_account_status_idx").on(
      t.accountId,
      t.status
    ),
    accountCreatedIdx: index("intake_request_account_created_idx").on(
      t.accountId,
      t.createdAt
    ),
  })
);
export type IntakeRequest = typeof intakeRequestsTable.$inferSelect;
export type NewIntakeRequest = typeof intakeRequestsTable.$inferInsert;

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
// T4.10 — Vendor portal.
//
// A `vendor_org` is a SaaS vendor (Notion, Linear, Microsoft, etc.) that has
// registered on Renewal Radar to push price-change, renewal-reminder and
// EOL announcements directly to their customers' inboxes here. It is
// DELIBERATELY SEPARATE from `vendor` (the customer-side "company we pay")
// because:
//   - A customer's notion of "their vendor" exists whether the vendor signs
//     up or not. We can't conflate the row that customers freely edit with
//     the row a real company authenticates against.
//   - Identity / verification model is different (vendors verify a domain;
//     customers don't).
//   - Auth is different (vendors use magic-link in /vendor; customers use
//     Clerk in /app). Customer Clerk orgs and vendor identities never mix.
//
// Soft-delete only (per the project-wide "never delete users" rule): every
// removal path flips `status` to `archived` and hides the row from normal
// reads. Audit-log rows reference vendor users by id, so a hard delete
// would break the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

export const vendorOrgStatusEnum = pgEnum("vendor_org_status", [
  "pending", // signed up, domain not yet verified
  "active", // verified, can publish
  "suspended", // staff-suspended (spam, fraud) — sign-in blocked
  "archived", // soft-deleted; preserved for audit-log FKs
]);

export const vendorUserRoleEnum = pgEnum("vendor_user_role", [
  "admin", // can invite + manage + publish
  "member", // can publish
]);

export const vendorOrgsTable = pgTable(
  "vendor_org",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly name shown to customers. Defaults to the email domain at
     *  signup; vendors edit it during onboarding. */
    displayName: text("display_name").notNull(),
    /** URL-safe handle. Used in /vendor/[slug] in later slices. Unique. */
    slug: text("slug").notNull(),
    /** The corporate domain claimed by this vendor. Lowercase. Once verified
     *  (Slice 2), no other vendor_org can claim the same domain. */
    primaryDomain: text("primary_domain").notNull(),
    /** Set when domain verification completes (Slice 2). Null = pending. */
    domainVerifiedAt: timestamp("domain_verified_at", { withTimezone: true }),
    status: vendorOrgStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugUnique: unique("vendor_org_slug_unique").on(t.slug),
    /** Domain uniqueness is enforced via a partial unique index in the
     *  migration so suspended/archived rows don't block re-registration. */
    domainIdx: index("vendor_org_domain_idx").on(t.primaryDomain),
    statusIdx: index("vendor_org_status_idx").on(t.status),
  })
);
export type VendorOrg = typeof vendorOrgsTable.$inferSelect;
export type NewVendorOrg = typeof vendorOrgsTable.$inferInsert;
export type VendorOrgStatus = (typeof vendorOrgStatusEnum.enumValues)[number];
export type VendorUserRole = (typeof vendorUserRoleEnum.enumValues)[number];

export const vendorUsersTable = pgTable(
  "vendor_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "restrict" }),
    /** Lowercased work email. Unique within a vendor_org. */
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: vendorUserRoleEnum("role").notNull().default("member"),
    /** Set on first successful magic-link redemption. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Soft-revoke. False = blocked from signing in. We never delete the
     *  row so audit-log references stay intact. */
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: unique("vendor_user_org_email_unique").on(
      t.vendorOrgId,
      t.email
    ),
    orgIdx: index("vendor_user_org_idx").on(t.vendorOrgId),
  })
);
export type VendorUser = typeof vendorUsersTable.$inferSelect;
export type NewVendorUser = typeof vendorUsersTable.$inferInsert;

/**
 * Single-use, short-lived magic-link tokens. We store only the SHA-256 hash
 * of the raw token; the raw value lives only in the email body and the URL.
 * If the database is dumped, an attacker still can't sign in.
 */
export const vendorMagicLinksTable = pgTable(
  "vendor_magic_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorUserId: uuid("vendor_user_id")
      .notNull()
      .references(() => vendorUsersTable.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the raw token. Lookup by tokenHash directly. */
    tokenHash: text("token_hash").notNull(),
    /** 15-minute default. Enforced in app layer too. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when redeemed → token becomes invalid (single-use). */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Loose forensic info; truncated. */
    requestedFromIp: text("requested_from_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashUnique: unique("vendor_magic_link_token_hash_unique").on(
      t.tokenHash
    ),
    userIdx: index("vendor_magic_link_user_idx").on(t.vendorUserId),
  })
);
export type VendorMagicLink = typeof vendorMagicLinksTable.$inferSelect;
export type NewVendorMagicLink = typeof vendorMagicLinksTable.$inferInsert;

/**
 * DB-backed session for a signed-in vendor user. The raw session token
 * lives only in a HttpOnly cookie; we store the SHA-256 hash. Revoke by
 * setting `revokedAt`. Sliding-window expiry via `lastSeenAt` is enforced
 * in the application layer.
 */
export const vendorSessionsTable = pgTable(
  "vendor_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorUserId: uuid("vendor_user_id")
      .notNull()
      .references(() => vendorUsersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Truncated to 200 chars in the writer. */
    userAgent: text("user_agent"),
    /** Truncated to 64 chars. */
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenHashUnique: unique("vendor_session_token_hash_unique").on(t.tokenHash),
    userActiveIdx: index("vendor_session_user_active_idx").on(
      t.vendorUserId,
      t.revokedAt
    ),
  })
);
export type VendorSession = typeof vendorSessionsTable.$inferSelect;
export type NewVendorSession = typeof vendorSessionsTable.$inferInsert;

/**
 * Vendor-side audit log. Parallel to `audit_log` (customer-side) but
 * scoped to `vendor_org_id`. We don't reuse `audit_log` because that
 * table is `account_id`-scoped (not nullable) and vendor events don't
 * belong to any customer account.
 */
export const vendorAuditLogTable = pgTable(
  "vendor_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "cascade" }),
    /** Null for system-initiated events (e.g. magic-link issuance from an
     *  unknown email — we record the attempt even when no vendor_user exists
     *  yet, but only after we've created the vendor_user row). */
    actorVendorUserId: uuid("actor_vendor_user_id").references(
      () => vendorUsersTable.id,
      { onDelete: "set null" }
    ),
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
    orgCreatedIdx: index("vendor_audit_log_org_created_idx").on(
      t.vendorOrgId,
      t.createdAt
    ),
  })
);
export type VendorAuditLogEntry = typeof vendorAuditLogTable.$inferSelect;
export type NewVendorAuditLogEntry = typeof vendorAuditLogTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// T4.10 Slice 2 — Vendor domain verification.
//
// A vendor proves control of `primaryDomain` by publishing a DNS TXT record.
// We generate a token; the vendor adds `renewalradar-verify=<token>` at the
// `_renewalradar.<domain>` host; a "Check now" action resolves it. Staff can
// also manually verify as a break-glass (method = 'manual').
//
// On success the parent `vendor_org` flips `domainVerifiedAt` + status →
// 'active' (only from 'pending' — never un-suspends a suspended org).
// ─────────────────────────────────────────────────────────────────────────────

export const vendorDomainVerificationMethodEnum = pgEnum(
  "vendor_domain_verification_method",
  ["dns_txt", "manual"]
);
export const vendorDomainVerificationStatusEnum = pgEnum(
  "vendor_domain_verification_status",
  ["pending", "verified", "failed"]
);

export const vendorDomainVerificationsTable = pgTable(
  "vendor_domain_verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "cascade" }),
    /** Denormalized from vendor_org at issue time. */
    domain: text("domain").notNull(),
    method: vendorDomainVerificationMethodEnum("method")
      .notNull()
      .default("dns_txt"),
    status: vendorDomainVerificationStatusEnum("status")
      .notNull()
      .default("pending"),
    /** The value the vendor publishes: `renewalradar-verify=<token>`. Public. */
    token: text("token").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Staff note when method = 'manual'. */
    verifierNote: text("verifier_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("vendor_domain_verification_org_idx").on(t.vendorOrgId),
  })
);
export type VendorDomainVerification =
  typeof vendorDomainVerificationsTable.$inferSelect;
export type NewVendorDomainVerification =
  typeof vendorDomainVerificationsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// T4.10 Slice 3 — Vendor ↔ Customer connection.
//
// Links a customer account to a verified vendor_org so the vendor can
// publish announcements into that customer's inbox. The CUSTOMER initiates
// (consent-first); the vendor accepts or declines. Either side can move it
// to 'blocked' (customer blocks the vendor; vendor declines future).
//
// Privacy: the vendor sees the customer's ACCOUNT NAME only — never the
// individual customer users' emails.
//
// One row per (accountId, vendorOrgId); status transitions in place so a
// re-request after a decline just moves the existing row back to 'pending'.
// ─────────────────────────────────────────────────────────────────────────────

export const vendorConnectionStatusEnum = pgEnum("vendor_connection_status", [
  "pending", // customer requested, awaiting vendor accept
  "connected", // active — vendor may publish to this customer
  "declined", // vendor declined the request
  "blocked", // customer blocked the vendor (terminal until customer re-opens)
]);
export const vendorConnectionInitiatorEnum = pgEnum(
  "vendor_connection_initiator",
  ["customer", "vendor"]
);

export const vendorConnectionsTable = pgTable(
  "vendor_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** The customer-side vendor row this connection is about (helps render). */
    customerVendorId: uuid("customer_vendor_id").references(
      () => vendorsTable.id,
      { onDelete: "set null" }
    ),
    status: vendorConnectionStatusEnum("status").notNull().default("pending"),
    initiatedBy: vendorConnectionInitiatorEnum("initiated_by")
      .notNull()
      .default("customer"),
    /** Customer user who initiated / blocked. */
    requestedByUserId: uuid("requested_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    /** Vendor user who accepted / declined. */
    decidedByVendorUserId: uuid("decided_by_vendor_user_id").references(
      () => vendorUsersTable.id,
      { onDelete: "set null" }
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUnique: unique("vendor_connection_pair_unique").on(
      t.accountId,
      t.vendorOrgId
    ),
    vendorStatusIdx: index("vendor_connection_vendor_status_idx").on(
      t.vendorOrgId,
      t.status
    ),
    accountIdx: index("vendor_connection_account_idx").on(t.accountId),
  })
);
export type VendorConnection = typeof vendorConnectionsTable.$inferSelect;
export type NewVendorConnection = typeof vendorConnectionsTable.$inferInsert;
export type VendorConnectionStatus =
  (typeof vendorConnectionStatusEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// T4.10 Slice 4 — Vendor announcements + per-customer delivery.
//
// A verified, active vendor publishes an announcement; it fans out to every
// 'connected' customer as a delivery row, and each customer is notified
// (in-app + email) via the shared dispatch helper.
//
// Slice 5 reads deliveries into the customer inbox; Slice 6 adds the report
// flow + per-announcement stats (computed from delivery rows — no counters).
// ─────────────────────────────────────────────────────────────────────────────

export const vendorAnnouncementKindEnum = pgEnum("vendor_announcement_kind", [
  "price_change",
  "renewal_reminder",
  "eol", // end-of-life / sunset
  "general",
]);
export const vendorAnnouncementStatusEnum = pgEnum(
  "vendor_announcement_status",
  ["draft", "published"]
);
export const vendorAnnouncementDeliveryStatusEnum = pgEnum(
  "vendor_announcement_delivery_status",
  ["delivered", "read", "accepted", "dismissed"]
);

export const vendorAnnouncementsTable = pgTable(
  "vendor_announcement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "cascade" }),
    kind: vendorAnnouncementKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Optional date the change takes effect (e.g. new price date). */
    effectiveDate: date("effective_date"),
    status: vendorAnnouncementStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByVendorUserId: uuid("created_by_vendor_user_id").references(
      () => vendorUsersTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index("vendor_announcement_org_created_idx").on(
      t.vendorOrgId,
      t.createdAt
    ),
  })
);
export type VendorAnnouncement = typeof vendorAnnouncementsTable.$inferSelect;
export type NewVendorAnnouncement =
  typeof vendorAnnouncementsTable.$inferInsert;
export type VendorAnnouncementKind =
  (typeof vendorAnnouncementKindEnum.enumValues)[number];

export const vendorAnnouncementDeliveriesTable = pgTable(
  "vendor_announcement_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => vendorAnnouncementsTable.id, { onDelete: "cascade" }),
    vendorOrgId: uuid("vendor_org_id")
      .notNull()
      .references(() => vendorOrgsTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(
      () => vendorConnectionsTable.id,
      { onDelete: "set null" }
    ),
    status: vendorAnnouncementDeliveryStatusEnum("status")
      .notNull()
      .default("delivered"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** When the customer accepted/dismissed. */
    actionedAt: timestamp("actioned_at", { withTimezone: true }),
    actionedByUserId: uuid("actioned_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    /** T4.10 Slice 6 — complaint flow. */
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    reportReason: text("report_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    announcementAccountUnique: unique(
      "vendor_announcement_delivery_announcement_account_unique"
    ).on(t.announcementId, t.accountId),
    accountStatusIdx: index(
      "vendor_announcement_delivery_account_status_idx"
    ).on(t.accountId, t.status),
    announcementIdx: index("vendor_announcement_delivery_announcement_idx").on(
      t.announcementId
    ),
    orgReportedIdx: index("vendor_announcement_delivery_org_reported_idx").on(
      t.vendorOrgId,
      t.reportedAt
    ),
  })
);
export type VendorAnnouncementDelivery =
  typeof vendorAnnouncementDeliveriesTable.$inferSelect;
export type NewVendorAnnouncementDelivery =
  typeof vendorAnnouncementDeliveriesTable.$inferInsert;
export type VendorAnnouncementDeliveryStatus =
  (typeof vendorAnnouncementDeliveryStatusEnum.enumValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// WEDGE PoC — Automatic spend-feed ingestion.
//
// A `spend_connection` binds an account to a transaction source (offline
// fixture by default; Ramp/Brex adapter when keys land). Raw lines land in
// `spend_transaction` (idempotent on (connectionId, externalId)). A pure
// detector groups them into `recurring_charge` SUGGESTIONS that a human
// confirms — confirmation reuses the existing CSV match/dedup + draft path.
// Nothing here ever auto-mutates a subscription (advisor, never agent).
// Soft-delete only (status flips), amounts integer cents, confidence 0–100.
// ─────────────────────────────────────────────────────────────────────────────

export const spendConnectorKindEnum = pgEnum("spend_connector_kind", [
  "fixture", // offline replay connector — the genuinely-working default
  "ramp", // keys-gated adapter seam
]);

export const spendConnectionStatusEnum = pgEnum("spend_connection_status", [
  "active",
  "paused",
  "error", // last sync failed; surfaced, not deleted
  "disconnected", // soft-delete terminal state
]);

export const spendTransactionStatusEnum = pgEnum("spend_transaction_status", [
  "ingested", // landed from connector, not yet grouped
  "grouped", // assigned to a detection group
  "ignored", // marked one-off / non-recurring
]);

export const recurringChargeStatusEnum = pgEnum("recurring_charge_status", [
  "detected", // detector produced it; awaiting human review
  "confirmed", // reconciled — linked to / created a subscription
  "dismissed", // user said "not a subscription"
  "superseded", // a later run produced a better group
]);

export const spendConnectionsTable = pgTable(
  "spend_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    kind: spendConnectorKindEnum("kind").notNull(),
    /** Encrypted via encryptJson(accountId, config). fixture → { datasetId }. */
    configCiphertext: text("config_ciphertext").notNull(),
    status: spendConnectionStatusEnum("status").notNull().default("active"),
    syncCursor: text("sync_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, {
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
    accountKindUnique: unique("spend_connection_account_kind_unique").on(
      t.accountId,
      t.kind
    ),
    accountStatusIdx: index("spend_connection_account_status_idx").on(
      t.accountId,
      t.status
    ),
  })
);
export type SpendConnection = typeof spendConnectionsTable.$inferSelect;
export type NewSpendConnection = typeof spendConnectionsTable.$inferInsert;

export const spendTransactionsTable = pgTable(
  "spend_transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => spendConnectionsTable.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // provider-stable id; dedup key
    rawMerchant: text("raw_merchant").notNull(), // "RAMP *NOTION LABS"
    normalizedMerchant: text("normalized_merchant").notNull(), // detector groups on it
    mcc: text("mcc"), // merchant category code
    amountCents: integer("amount_cents").notNull(), // + charge, - refund
    currency: text("currency").notNull().default("USD"),
    chargedOn: date("charged_on").notNull(), // provider posted date
    cardLabel: text("card_label"),
    status: spendTransactionStatusEnum("status").notNull().default("ingested"),
    /** Soft FK (no .references()) consistent with never-delete; reads filter
     *  by recurring_charge status. */
    recurringChargeId: uuid("recurring_charge_id"),
    rawPayloadJson: jsonb("raw_payload_json"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    connExternalUnique: unique("spend_transaction_conn_external_unique").on(
      t.connectionId,
      t.externalId
    ),
    accountMerchantChargedIdx: index(
      "spend_transaction_account_merchant_charged_idx"
    ).on(t.accountId, t.normalizedMerchant, t.chargedOn),
    accountStatusIdx: index("spend_transaction_account_status_idx").on(
      t.accountId,
      t.status
    ),
  })
);
export type SpendTransaction = typeof spendTransactionsTable.$inferSelect;
export type NewSpendTransaction = typeof spendTransactionsTable.$inferInsert;

export const recurringChargesTable = pgTable(
  "recurring_charge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => spendConnectionsTable.id, { onDelete: "cascade" }),
    normalizedMerchant: text("normalized_merchant").notNull(),
    currency: text("currency").notNull().default("USD"),
    suggestedVendorName: text("suggested_vendor_name").notNull(),
    detectedCycle: billingCycleEnum("detected_cycle").notNull(),
    typicalAmountCents: integer("typical_amount_cents").notNull(), // median
    latestAmountCents: integer("latest_amount_cents").notNull(),
    amountDriftPct: integer("amount_drift_pct").notNull().default(0), // signed
    confidence: integer("confidence_pct").notNull(), // 0..100
    sampleSize: integer("sample_size").notNull(),
    needsManualConfirm: boolean("needs_manual_confirm").notNull().default(false),
    firstChargedOn: date("first_charged_on").notNull(),
    lastChargedOn: date("last_charged_on").notNull(),
    projectedNextChargeOn: date("projected_next_charge_on"), // null when sampleSize<2
    status: recurringChargeStatusEnum("status").notNull().default("detected"),
    reconciliationOutcome: text("reconciliation_outcome"), // matched_existing | created_draft
    subscriptionId: uuid("subscription_id").references(
      () => subscriptionsTable.id,
      { onDelete: "set null" }
    ),
    reviewedByUserId: uuid("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    accountStatusIdx: index("recurring_charge_account_status_idx").on(
      t.accountId,
      t.status
    ),
    accountMerchantIdx: index("recurring_charge_account_merchant_idx").on(
      t.accountId,
      t.normalizedMerchant
    ),
    /** Partial unique so onConflictDoUpdate has a real target AND a later
     *  `detected` row can coexist with a prior dismissed/superseded row for
     *  the same scope. A plain index can't back ON CONFLICT — the cron
     *  would race read-then-write and stack duplicate suggestions.
     *
     *  `currency` is part of the key: the detector groups by
     *  (merchant, currency), so a vendor billing in two currencies at the same
     *  cadence is two legitimate suggestions — without currency here the second
     *  would silently clobber the first on conflict (EDGE-1). The detector also
     *  dedups candidates by this exact scope before upsert, so the two keys
     *  (detect-side and persist-side) are identical and no collision is
     *  possible. */
    detectedScopeUnique: uniqueIndex("recurring_charge_detected_scope_unique")
      .on(t.connectionId, t.normalizedMerchant, t.currency, t.detectedCycle)
      .where(sql`status = 'detected'`),
  })
);
export type RecurringCharge = typeof recurringChargesTable.$inferSelect;
export type NewRecurringCharge = typeof recurringChargesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// WEDGE PoC — Renewal Intelligence Brief (genuine multi-signal reasoning).
//
// Append-only persisted briefs. `engine` records honest provenance
// ("deterministic" | "llm") — the UI never labels deterministic output as LLM.
// The brief reasons over signals reconstructed from existing data
// (vendor_event price history, benchmark, notice deadline, decision context);
// there is NO charges table — the trajectory is rebuilt from vendor_event.
// ─────────────────────────────────────────────────────────────────────────────

export const renewalBriefsTable = pgTable(
  "renewal_brief",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
    renewalEventId: uuid("renewal_event_id").references(
      () => renewalEventsTable.id,
      { onDelete: "set null" }
    ),
    engine: text("engine").notNull(), // "deterministic" | "llm"
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    briefVersion: text("brief_version").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    confidence: integer("confidence_pct").notNull(),
    briefJson: jsonb("brief_json").notNull(),
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountSubIdx: index("renewal_brief_account_sub_idx").on(
      t.accountId,
      t.subscriptionId,
      t.createdAt
    ),
  })
);
export type RenewalBrief = typeof renewalBriefsTable.$inferSelect;
export type NewRenewalBrief = typeof renewalBriefsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// A3 — Safe-agent internal renewal-notice drafts.
//
// Renewal Radar DRAFTS an INTERNAL memo (to the procurement owner/team)
// deterministically composed from the stored Renewal Intelligence Brief. The
// human edits + sends it. It is NEVER addressed to or sent to the vendor —
// that's the binding advisor-not-agent line. Append-only history; the human can
// regenerate (new row) or edit (status flips to 'edited').
// ─────────────────────────────────────────────────────────────────────────────
export const renewalNoticeStatusEnum = pgEnum("renewal_notice_status", [
  "draft",
  "edited",
  "archived",
]);

export const renewalNoticeDraftsTable = pgTable(
  "renewal_notice_draft",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
    /** The brief this memo was composed from (null if composed without one). */
    renewalBriefId: uuid("renewal_brief_id").references(
      () => renewalBriefsTable.id,
      { onDelete: "set null" }
    ),
    status: renewalNoticeStatusEnum("status").notNull().default("draft"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, {
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
    accountSubIdx: index("renewal_notice_draft_account_sub_idx").on(
      t.accountId,
      t.subscriptionId
    ),
  })
);
export type RenewalNoticeDraft = typeof renewalNoticeDraftsTable.$inferSelect;
export type NewRenewalNoticeDraft = typeof renewalNoticeDraftsTable.$inferInsert;

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

export type UserArchive = typeof usersArchiveTable.$inferSelect;
export type NewUserArchive = typeof usersArchiveTable.$inferInsert;

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

export type AiReasoningUsage = typeof aiReasoningUsageTable.$inferSelect;
export type NewAiReasoningUsage = typeof aiReasoningUsageTable.$inferInsert;
export type AiReasoningSurface = "brief" | "ask";

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
