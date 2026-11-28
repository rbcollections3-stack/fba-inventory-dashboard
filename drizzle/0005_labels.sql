ALTER TABLE "shipments" ADD COLUMN "amazon_lookup" jsonb;--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "fnsku" text;