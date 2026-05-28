DO $$ BEGIN
 CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'quarterly', 'annual', 'multi_year');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_channel" AS ENUM('email', 'in_app');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'suppressed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_trigger" AS ENUM('notice_window_30', 'notice_window_14', 'notice_window_7', 'notice_window_3', 'notice_window_1', 'notice_window_missed', 'renewal_90', 'renewal_60', 'renewal_30', 'renewal_14', 'renewal_7', 'renewal_1', 'weekly_digest', 'monthly_summary', 'decision_confirmation', 'welcome');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."plan_tier" AS ENUM('free_forever', 'starter', 'growth', 'pro', 'enterprise');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."renewal_decision" AS ENUM('renewed', 'renewed_with_adjustments', 'downgraded', 'cancelled', 'deferred');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."renewal_event_status" AS ENUM('upcoming', 'notice_window', 'action_needed', 'processed', 'missed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."subscription_status" AS ENUM('draft', 'active', 'paused', 'pending_cancellation', 'cancelled', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"billing_email" text NOT NULL,
	"plan_tier" "plan_tier" DEFAULT 'free_forever' NOT NULL,
	"trial_started_at" timestamp with time zone,
	"trial_expires_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "account_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_entity_type" text,
	"target_entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"trigger" "notification_trigger" NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dedupe" UNIQUE("user_id","trigger","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewal_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"renewal_date" date NOT NULL,
	"notice_deadline" date NOT NULL,
	"status" "renewal_event_status" DEFAULT 'upcoming' NOT NULL,
	"decision" "renewal_decision",
	"decision_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_note" text,
	"adjusted_seat_count" integer,
	"adjusted_unit_price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"plan_name" text,
	"billing_cycle" "billing_cycle" NOT NULL,
	"term_start_date" date NOT NULL,
	"term_end_date" date NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"total_seats" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cost_per_period_cents" integer NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"work_email" text NOT NULL,
	"full_name" text,
	"role" text DEFAULT 'owner' NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "user_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "user_account_id_work_email_unique" UNIQUE("account_id","work_email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"cancellation_url" text,
	"cancellation_email" text,
	"cancellation_phone" text,
	"cancellation_notes" text,
	"account_manager_name" text,
	"account_manager_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_account_id_name_unique" UNIQUE("account_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_event" ADD CONSTRAINT "renewal_event_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_event" ADD CONSTRAINT "renewal_event_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_event" ADD CONSTRAINT "renewal_event_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor" ADD CONSTRAINT "vendor_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_account_created_idx" ON "audit_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_account_idx" ON "notification" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_user_status_idx" ON "notification" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_event_subscription_idx" ON "renewal_event" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_event_account_notice_idx" ON "renewal_event" USING btree ("account_id","notice_deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_event_account_renewal_idx" ON "renewal_event" USING btree ("account_id","renewal_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_account_idx" ON "subscription" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_account_status_idx" ON "subscription" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_account_term_end_idx" ON "subscription" USING btree ("account_id","term_end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_vendor_idx" ON "subscription" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_account_idx" ON "user" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_account_idx" ON "vendor" USING btree ("account_id");