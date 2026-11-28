CREATE TABLE "forecast_settings" (
	"sku_id" integer PRIMARY KEY NOT NULL,
	"manual_daily_sales" numeric(10, 2),
	"note" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_settings_manual_positive" CHECK ("forecast_settings"."manual_daily_sales" is null or "forecast_settings"."manual_daily_sales" > 0)
);
--> statement-breakpoint
ALTER TABLE "forecast_settings" ADD CONSTRAINT "forecast_settings_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_settings" ADD CONSTRAINT "forecast_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;