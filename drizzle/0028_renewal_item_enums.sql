ALTER TYPE "ai_field_key" ADD VALUE IF NOT EXISTS 'expiry_date';--> statement-breakpoint
ALTER TYPE "ai_field_key" ADD VALUE IF NOT EXISTS 'issuer';--> statement-breakpoint
ALTER TYPE "ai_field_key" ADD VALUE IF NOT EXISTS 'reference_number';--> statement-breakpoint
ALTER TYPE "billing_cycle" ADD VALUE IF NOT EXISTS 'one_time';--> statement-breakpoint
ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'license';--> statement-breakpoint
ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'certificate';--> statement-breakpoint
ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'policy';--> statement-breakpoint
ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'notice';--> statement-breakpoint
ALTER TYPE "document_kind" ADD VALUE IF NOT EXISTS 'statement';
