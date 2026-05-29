DO $$ BEGIN
 CREATE TYPE "public"."intake_request_status" AS ENUM('pending', 'approved', 'denied', 'duplicate', 'withdrawn');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"product" text NOT NULL,
	"plan_notes" text,
	"business_case" text NOT NULL,
	"estimated_annual_usd_cents" integer NOT NULL,
	"expected_start_date" date,
	"status" "intake_request_status" DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewer_note" text,
	"created_subscription_id" uuid,
	"linked_existing_subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_created_subscription_id_subscription_id_fk" FOREIGN KEY ("created_subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_linked_existing_subscription_id_subscription_id_fk" FOREIGN KEY ("linked_existing_subscription_id") REFERENCES "public"."subscription"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_account_status_idx" ON "intake_request" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_account_created_idx" ON "intake_request" USING btree ("account_id","created_at");