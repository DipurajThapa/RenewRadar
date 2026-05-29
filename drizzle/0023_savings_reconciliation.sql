ALTER TYPE "vendor_event_kind" ADD VALUE IF NOT EXISTS 'savings_realized';--> statement-breakpoint
ALTER TABLE "savings_record" ADD COLUMN IF NOT EXISTS "expected_savings_realized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "savings_record" ADD COLUMN IF NOT EXISTS "realized_new_annual_usd_cents" integer;--> statement-breakpoint
ALTER TABLE "savings_record" ADD COLUMN IF NOT EXISTS "realized_saved_annual_usd_cents" integer;--> statement-breakpoint
ALTER TABLE "savings_record" ADD COLUMN IF NOT EXISTS "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "savings_record" ADD COLUMN IF NOT EXISTS "reconciliation_status" text;
