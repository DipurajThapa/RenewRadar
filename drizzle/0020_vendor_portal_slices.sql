DO $$ BEGIN
 CREATE TYPE "public"."vendor_announcement_delivery_status" AS ENUM('delivered', 'read', 'accepted', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_announcement_kind" AS ENUM('price_change', 'renewal_reminder', 'eol', 'general');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_announcement_status" AS ENUM('draft', 'published');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_connection_initiator" AS ENUM('customer', 'vendor');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_connection_status" AS ENUM('pending', 'connected', 'declined', 'blocked');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_domain_verification_method" AS ENUM('dns_txt', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_domain_verification_status" AS ENUM('pending', 'verified', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "notification_trigger" ADD VALUE IF NOT EXISTS 'vendor_announcement';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_announcement_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid,
	"status" "vendor_announcement_delivery_status" DEFAULT 'delivered' NOT NULL,
	"read_at" timestamp with time zone,
	"actioned_at" timestamp with time zone,
	"actioned_by_user_id" uuid,
	"reported_at" timestamp with time zone,
	"report_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_announcement_delivery_announcement_account_unique" UNIQUE("announcement_id","account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"kind" "vendor_announcement_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_date" date,
	"status" "vendor_announcement_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_vendor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"customer_vendor_id" uuid,
	"status" "vendor_connection_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" "vendor_connection_initiator" DEFAULT 'customer' NOT NULL,
	"requested_by_user_id" uuid,
	"decided_by_vendor_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_connection_pair_unique" UNIQUE("account_id","vendor_org_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_domain_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"method" "vendor_domain_verification_method" DEFAULT 'dns_txt' NOT NULL,
	"status" "vendor_domain_verification_status" DEFAULT 'pending' NOT NULL,
	"token" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verifier_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement_delivery" ADD CONSTRAINT "vendor_announcement_delivery_announcement_id_vendor_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."vendor_announcement"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement_delivery" ADD CONSTRAINT "vendor_announcement_delivery_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement_delivery" ADD CONSTRAINT "vendor_announcement_delivery_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement_delivery" ADD CONSTRAINT "vendor_announcement_delivery_connection_id_vendor_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."vendor_connection"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement_delivery" ADD CONSTRAINT "vendor_announcement_delivery_actioned_by_user_id_user_id_fk" FOREIGN KEY ("actioned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement" ADD CONSTRAINT "vendor_announcement_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_announcement" ADD CONSTRAINT "vendor_announcement_created_by_vendor_user_id_vendor_user_id_fk" FOREIGN KEY ("created_by_vendor_user_id") REFERENCES "public"."vendor_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_connection" ADD CONSTRAINT "vendor_connection_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_connection" ADD CONSTRAINT "vendor_connection_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_connection" ADD CONSTRAINT "vendor_connection_customer_vendor_id_vendor_id_fk" FOREIGN KEY ("customer_vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_connection" ADD CONSTRAINT "vendor_connection_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_connection" ADD CONSTRAINT "vendor_connection_decided_by_vendor_user_id_vendor_user_id_fk" FOREIGN KEY ("decided_by_vendor_user_id") REFERENCES "public"."vendor_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_domain_verification" ADD CONSTRAINT "vendor_domain_verification_vendor_org_id_vendor_org_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."vendor_org"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_announcement_delivery_account_status_idx" ON "vendor_announcement_delivery" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_announcement_delivery_announcement_idx" ON "vendor_announcement_delivery" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_announcement_delivery_org_reported_idx" ON "vendor_announcement_delivery" USING btree ("vendor_org_id","reported_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_announcement_org_created_idx" ON "vendor_announcement" USING btree ("vendor_org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_connection_vendor_status_idx" ON "vendor_connection" USING btree ("vendor_org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_connection_account_idx" ON "vendor_connection" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_domain_verification_org_idx" ON "vendor_domain_verification" USING btree ("vendor_org_id");