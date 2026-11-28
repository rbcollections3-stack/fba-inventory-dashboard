-- Phase 6: China orders. Every statement is safe to run twice, because PR
-- previews share the live database (see SETUP.md).
ALTER TYPE "public"."count_source" ADD VALUE IF NOT EXISTS 'china_order';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "china_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"sku_id" integer NOT NULL,
	"cases" integer NOT NULL,
	"units_per_case" integer NOT NULL,
	CONSTRAINT "china_order_lines_cases_positive" CHECK ("china_order_lines"."cases" > 0),
	CONSTRAINT "china_order_lines_units_per_case_positive" CHECK ("china_order_lines"."units_per_case" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "china_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"supplier" text,
	"po_number" text,
	"ordered_on" date NOT NULL,
	"expected_on" date NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	CONSTRAINT "china_orders_status_valid" CHECK ("china_orders"."status" in ('ordered', 'received', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "china_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"sku_id" integer NOT NULL,
	"cases" integer NOT NULL,
	"received_on" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "china_receipts_cases_nonnegative" CHECK ("china_receipts"."cases" >= 0)
);
--> statement-breakpoint
ALTER TABLE "warehouse_counts" ADD COLUMN IF NOT EXISTS "china_order_id" integer;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_order_lines_order_id_china_orders_id_fk') THEN
  ALTER TABLE "china_order_lines" ADD CONSTRAINT "china_order_lines_order_id_china_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."china_orders"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_order_lines_sku_id_skus_id_fk') THEN
  ALTER TABLE "china_order_lines" ADD CONSTRAINT "china_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_orders_created_by_users_id_fk') THEN
  ALTER TABLE "china_orders" ADD CONSTRAINT "china_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_orders_closed_by_users_id_fk') THEN
  ALTER TABLE "china_orders" ADD CONSTRAINT "china_orders_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_receipts_order_id_china_orders_id_fk') THEN
  ALTER TABLE "china_receipts" ADD CONSTRAINT "china_receipts_order_id_china_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."china_orders"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_receipts_sku_id_skus_id_fk') THEN
  ALTER TABLE "china_receipts" ADD CONSTRAINT "china_receipts_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'china_receipts_created_by_users_id_fk') THEN
  ALTER TABLE "china_receipts" ADD CONSTRAINT "china_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "china_order_lines_sku_key" ON "china_order_lines" USING btree ("order_id","sku_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_order_lines_sku_idx" ON "china_order_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_orders_status_idx" ON "china_orders" USING btree ("status","expected_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_receipts_order_idx" ON "china_receipts" USING btree ("order_id");--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_counts_china_order_id_china_orders_id_fk') THEN
  ALTER TABLE "warehouse_counts" ADD CONSTRAINT "warehouse_counts_china_order_id_china_orders_id_fk" FOREIGN KEY ("china_order_id") REFERENCES "public"."china_orders"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;