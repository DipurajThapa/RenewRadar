DO $$ BEGIN
 CREATE TYPE "public"."renewal_item_category" AS ENUM('saas_subscription', 'software_license', 'contract', 'vendor_agreement', 'insurance_policy', 'compliance_cert', 'government_notice', 'domain_dns', 'warranty_amc', 'professional_membership', 'personal_item', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "category" "renewal_item_category" DEFAULT 'saas_subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "attributes_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
