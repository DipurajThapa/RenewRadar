DO $$ BEGIN
 CREATE TYPE "public"."recurring_charge_status" AS ENUM('detected', 'confirmed', 'dismissed', 'superseded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."spend_connection_status" AS ENUM('active', 'paused', 'error', 'disconnected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."spend_connector_kind" AS ENUM('fixture', 'ramp');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."spend_transaction_status" AS ENUM('ingested', 'grouped', 'ignored');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "vendor_event_kind" ADD VALUE IF NOT EXISTS 'renewal_brief_generated';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"normalized_merchant" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"suggested_vendor_name" text NOT NULL,
	"detected_cycle" "billing_cycle" NOT NULL,
	"typical_amount_cents" integer NOT NULL,
	"latest_amount_cents" integer NOT NULL,
	"amount_drift_pct" integer DEFAULT 0 NOT NULL,
	"confidence_pct" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"needs_manual_confirm" boolean DEFAULT false NOT NULL,
	"first_charged_on" date NOT NULL,
	"last_charged_on" date NOT NULL,
	"projected_next_charge_on" date,
	"status" "recurring_charge_status" DEFAULT 'detected' NOT NULL,
	"reconciliation_outcome" text,
	"subscription_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewal_brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"renewal_event_id" uuid,
	"engine" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"brief_version" text NOT NULL,
	"recommended_action" text NOT NULL,
	"confidence_pct" integer NOT NULL,
	"brief_json" jsonb NOT NULL,
	"cost_usd_micros" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spend_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "spend_connector_kind" NOT NULL,
	"config_ciphertext" text NOT NULL,
	"status" "spend_connection_status" DEFAULT 'active' NOT NULL,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_connection_account_kind_unique" UNIQUE("account_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spend_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"raw_merchant" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"mcc" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"charged_on" date NOT NULL,
	"card_label" text,
	"status" "spend_transaction_status" DEFAULT 'ingested' NOT NULL,
	"recurring_charge_id" uuid,
	"raw_payload_json" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_transaction_conn_external_unique" UNIQUE("connection_id","external_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_connection_id_spend_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."spend_connection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_brief" ADD CONSTRAINT "renewal_brief_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_brief" ADD CONSTRAINT "renewal_brief_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_brief" ADD CONSTRAINT "renewal_brief_renewal_event_id_renewal_event_id_fk" FOREIGN KEY ("renewal_event_id") REFERENCES "public"."renewal_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_brief" ADD CONSTRAINT "renewal_brief_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spend_connection" ADD CONSTRAINT "spend_connection_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spend_connection" ADD CONSTRAINT "spend_connection_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spend_transaction" ADD CONSTRAINT "spend_transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spend_transaction" ADD CONSTRAINT "spend_transaction_connection_id_spend_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."spend_connection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_charge_account_status_idx" ON "recurring_charge" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_charge_account_merchant_idx" ON "recurring_charge" USING btree ("account_id","normalized_merchant");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_charge_detected_triple_unique" ON "recurring_charge" USING btree ("connection_id","normalized_merchant","detected_cycle") WHERE status = 'detected';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_brief_account_sub_idx" ON "renewal_brief" USING btree ("account_id","subscription_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_connection_account_status_idx" ON "spend_connection" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_transaction_account_merchant_charged_idx" ON "spend_transaction" USING btree ("account_id","normalized_merchant","charged_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_transaction_account_status_idx" ON "spend_transaction" USING btree ("account_id","status");