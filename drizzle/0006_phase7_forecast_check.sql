-- Phase 7: forecast check. New tables only; safe to run more than once.
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