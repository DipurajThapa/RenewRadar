DO $$ BEGIN
 CREATE TYPE "public"."renewal_approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "require_approvals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "renewal_event" ADD COLUMN "approval_status" "renewal_approval_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "renewal_event" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "renewal_event" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "renewal_event" ADD CONSTRAINT "renewal_event_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "renewal_event_account_approval_idx" ON "renewal_event" USING btree ("account_id","approval_status");