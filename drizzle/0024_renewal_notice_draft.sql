DO $$ BEGIN
 CREATE TYPE "public"."renewal_notice_status" AS ENUM('draft', 'edited', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "renewal_notice_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"renewal_brief_id" uuid,
	"status" "renewal_notice_status" DEFAULT 'draft' NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_notice_draft" ADD CONSTRAINT "renewal_notice_draft_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_notice_draft" ADD CONSTRAINT "renewal_notice_draft_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_notice_draft" ADD CONSTRAINT "renewal_notice_draft_renewal_brief_id_renewal_brief_id_fk" FOREIGN KEY ("renewal_brief_id") REFERENCES "public"."renewal_brief"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_notice_draft" ADD CONSTRAINT "renewal_notice_draft_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_notice_draft_account_sub_idx" ON "renewal_notice_draft" USING btree ("account_id","subscription_id");