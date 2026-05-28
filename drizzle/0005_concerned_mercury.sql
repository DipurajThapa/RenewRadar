DO $$ BEGIN
 CREATE TYPE "public"."ai_extraction_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ai_field_key" AS ENUM('renewal_date', 'notice_period_days', 'auto_renewal', 'contract_value_cents', 'price_increase_clause', 'cancellation_method');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ai_field_review_status" AS ENUM('pending', 'accepted', 'edited', 'rejected', 'applied');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."document_extraction_status" AS ENUM('pending', 'extracting', 'ready', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."document_kind" AS ENUM('contract', 'amendment', 'invoice', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_extracted_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"subscription_id" uuid,
	"field_key" "ai_field_key" NOT NULL,
	"raw_value" text,
	"parsed_value_json" jsonb,
	"confidence_pct" integer NOT NULL,
	"evidence_quote" text NOT NULL,
	"evidence_page_number" integer,
	"review_status" "ai_field_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewer_edited_value_json" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_extraction_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "ai_extraction_run_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"cost_usd_micros" integer,
	"pages_charged" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"subscription_id" uuid,
	"uploaded_by_user_id" uuid,
	"kind" "document_kind" DEFAULT 'contract' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"page_count" integer,
	"text_extraction_status" "document_extraction_status" DEFAULT 'pending' NOT NULL,
	"text_content" text,
	"text_extraction_error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extracted_field" ADD CONSTRAINT "ai_extracted_field_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extracted_field" ADD CONSTRAINT "ai_extracted_field_run_id_ai_extraction_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_extraction_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extracted_field" ADD CONSTRAINT "ai_extracted_field_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extracted_field" ADD CONSTRAINT "ai_extracted_field_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extracted_field" ADD CONSTRAINT "ai_extracted_field_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extraction_run" ADD CONSTRAINT "ai_extraction_run_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extraction_run" ADD CONSTRAINT "ai_extraction_run_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extracted_field_account_idx" ON "ai_extracted_field" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extracted_field_run_idx" ON "ai_extracted_field" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extracted_field_account_status_idx" ON "ai_extracted_field" USING btree ("account_id","review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extracted_field_subscription_idx" ON "ai_extracted_field" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extraction_run_account_idx" ON "ai_extraction_run" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extraction_run_document_idx" ON "ai_extraction_run" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_extraction_run_account_started_idx" ON "ai_extraction_run" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_account_idx" ON "document" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_subscription_idx" ON "document" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_account_uploaded_idx" ON "document" USING btree ("account_id","uploaded_at");