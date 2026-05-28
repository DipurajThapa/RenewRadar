DO $$ BEGIN
 CREATE TYPE "public"."compliance_artifact_kind" AS ENUM('dpa', 'msa', 'nda', 'soc2_type_ii_report', 'soc2_type_i_report', 'iso_27001', 'iso_27018', 'iso_27701', 'hipaa_baa', 'pci_aoc', 'gdpr_addendum', 'insurance_certificate', 'w9', 'w8_ben_e', 'vendor_security_questionnaire', 'subprocessor_list', 'penetration_test_summary', 'incident_response_plan', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."decision_rationale_code" AS ENUM('cost_reduction', 'low_usage', 'poor_performance', 'no_longer_needed', 'found_alternative', 'strategic_pivot', 'security_concern', 'compliance_concern', 'consolidation', 'team_change', 'vendor_acquired', 'price_too_high', 'missing_features', 'support_issues');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."negotiation_lever" AS ENUM('none', 'multi_year_commit', 'payment_terms', 'volume_increase', 'competing_quote', 'executive_escalation', 'consolidated_with_other_products', 'threatened_cancellation', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_event_kind" AS ENUM('subscription_created', 'subscription_updated', 'subscription_cancelled', 'contract_uploaded', 'contract_field_applied', 'renewal_decision_logged', 'renewal_decision_approved', 'renewal_decision_rejected', 'savings_recorded', 'price_changed', 'seat_count_changed', 'owner_changed', 'compliance_doc_received', 'compliance_doc_expired', 'notice_deadline_missed', 'user_note_added');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"kind" "compliance_artifact_kind" NOT NULL,
	"received_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"document_id" uuid,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_artifact_account_vendor_kind_unique" UNIQUE("account_id","vendor_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"renewal_event_id" uuid NOT NULL,
	"rationale_codes_json" jsonb NOT NULL,
	"alternatives_considered" text,
	"stakeholders_consulted_json" jsonb,
	"negotiation_lever" "negotiation_lever" DEFAULT 'none' NOT NULL,
	"negotiation_outcome_summary" text,
	"expected_annual_savings_usd_cents" integer,
	"expected_savings_realized_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_context_renewal_event_id_unique" UNIQUE("renewal_event_id"),
	CONSTRAINT "decision_context_account_renewal_unique" UNIQUE("account_id","renewal_event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"subscription_id" uuid,
	"kind" "vendor_event_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_artifact" ADD CONSTRAINT "compliance_artifact_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_artifact" ADD CONSTRAINT "compliance_artifact_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_artifact" ADD CONSTRAINT "compliance_artifact_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_artifact" ADD CONSTRAINT "compliance_artifact_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_context" ADD CONSTRAINT "decision_context_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_context" ADD CONSTRAINT "decision_context_renewal_event_id_renewal_event_id_fk" FOREIGN KEY ("renewal_event_id") REFERENCES "public"."renewal_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_context" ADD CONSTRAINT "decision_context_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_event" ADD CONSTRAINT "vendor_event_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_event" ADD CONSTRAINT "vendor_event_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_event" ADD CONSTRAINT "vendor_event_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_event" ADD CONSTRAINT "vendor_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_artifact_account_vendor_idx" ON "compliance_artifact" USING btree ("account_id","vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_artifact_account_expires_idx" ON "compliance_artifact" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_context_account_idx" ON "decision_context" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_event_account_vendor_occurred_idx" ON "vendor_event" USING btree ("account_id","vendor_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_event_account_kind_idx" ON "vendor_event" USING btree ("account_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_event_subscription_idx" ON "vendor_event" USING btree ("subscription_id");