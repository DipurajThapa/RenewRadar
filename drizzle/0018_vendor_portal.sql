DO $$ BEGIN
 CREATE TYPE "public"."vendor_org_status" AS ENUM('pending', 'active', 'suspended', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_user_role" AS ENUM('admin', 'member');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"actor_vendor_user_id" uuid,
	"action" text NOT NULL,
	"target_entity_type" text,
	"target_entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_magic_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"requested_from_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_magic_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_org" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"primary_domain" text NOT NULL,
	"domain_verified_at" timestamp with time zone,
	"status" "vendor_org_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_org_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "vendor_user_role" DEFAULT 'member' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_user_org_email_unique" UNIQUE("vendor_org_id","email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_audit_log" ADD CONSTRAINT "vendor_audit_log_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_audit_log" ADD CONSTRAINT "vendor_audit_log_actor_vendor_user_id_vendor_user_id_fk" FOREIGN KEY ("actor_vendor_user_id") REFERENCES "public"."vendor_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_magic_link" ADD CONSTRAINT "vendor_magic_link_vendor_user_id_vendor_user_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "public"."vendor_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_session" ADD CONSTRAINT "vendor_session_vendor_user_id_vendor_user_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "public"."vendor_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_user" ADD CONSTRAINT "vendor_user_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_audit_log_org_created_idx" ON "vendor_audit_log" USING btree ("vendor_org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_magic_link_user_idx" ON "vendor_magic_link" USING btree ("vendor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_org_domain_idx" ON "vendor_org" USING btree ("primary_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_org_status_idx" ON "vendor_org" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_session_user_active_idx" ON "vendor_session" USING btree ("vendor_user_id","revoked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_user_org_idx" ON "vendor_user" USING btree ("vendor_org_id");--> statement-breakpoint
-- Partial unique index: one ACTIVE vendor_org per domain.
-- Suspended/archived rows don't block re-registration of the same domain.
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_org_active_domain_unique"
  ON "vendor_org" ("primary_domain")
  WHERE status IN ('pending', 'active');