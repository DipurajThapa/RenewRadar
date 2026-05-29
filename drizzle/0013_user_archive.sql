CREATE TABLE IF NOT EXISTS "user_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"work_email" text NOT NULL,
	"full_name" text,
	"role" "user_role" NOT NULL,
	"notification_prefs" jsonb NOT NULL,
	"original_created_at" timestamp with time zone NOT NULL,
	"original_last_login_at" timestamp with time zone,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_reason" text NOT NULL,
	"archived_by_user_id" uuid,
	"archived_note" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_archive_account_idx" ON "user_archive" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_archive_email_idx" ON "user_archive" USING btree ("work_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_archive_clerk_idx" ON "user_archive" USING btree ("clerk_user_id");