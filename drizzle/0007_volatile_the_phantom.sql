CREATE TABLE IF NOT EXISTS "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"company" text,
	"job_title" text,
	"source" text NOT NULL,
	"intent" text DEFAULT 'other' NOT NULL,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"consent_marketing" boolean DEFAULT false NOT NULL,
	"metadata_json" jsonb,
	"contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_created_idx" ON "lead" USING btree ("status","created_at");