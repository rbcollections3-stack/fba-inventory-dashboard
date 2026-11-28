-- Phase 7: forecast check. New tables only; every statement is safe to run more than once.
--
-- Safety net first: Phase 6 and Phase 7 were built side by side and their PR
-- previews migrated the shared live database in an unknown order. Drizzle skips
-- a migration whose date is older than the newest one already applied, so the
-- Phase 6 statements (all "if not exists") are repeated here to make sure the
-- China order tables exist whatever order the previews ran in.
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
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_daily_log" (
	"sku_id" integer NOT NULL,
	"day" date NOT NULL,
	"planned_rate" numeric(12, 4),
	"rate_source" text NOT NULL,
	"season_pct" integer,
	"out_of_stock_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_daily_log_sku_id_day_pk" PRIMARY KEY("sku_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "season_months" (
	"listing_id" integer NOT NULL,
	"month" integer NOT NULL,
	"percent" integer NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_months_listing_id_month_pk" PRIMARY KEY("listing_id","month"),
	CONSTRAINT "season_months_month_valid" CHECK ("season_months"."month" between 1 and 12),
	CONSTRAINT "season_months_percent_valid" CHECK ("season_months"."percent" between 10 and 500)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "season_settings" (
	"listing_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_daily_log_sku_id_skus_id_fk') THEN
    ALTER TABLE "forecast_daily_log" ADD CONSTRAINT "forecast_daily_log_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_months_listing_id_listings_id_fk') THEN
    ALTER TABLE "season_months" ADD CONSTRAINT "season_months_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_months_updated_by_users_id_fk') THEN
    ALTER TABLE "season_months" ADD CONSTRAINT "season_months_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_settings_listing_id_listings_id_fk') THEN
    ALTER TABLE "season_settings" ADD CONSTRAINT "season_settings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'season_settings_updated_by_users_id_fk') THEN
    ALTER TABLE "season_settings" ADD CONSTRAINT "season_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecast_daily_log_day_idx" ON "forecast_daily_log" USING btree ("day");