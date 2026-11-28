CREATE TYPE "public"."amazon_report_kind" AS ENUM('ledger_detail', 'fba_inventory');--> statement-breakpoint
CREATE TYPE "public"."amazon_report_source" AS ENUM('upload', 'sp_api');--> statement-breakpoint
CREATE TABLE "amazon_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "amazon_report_kind" NOT NULL,
	"source" "amazon_report_source" NOT NULL,
	"file_name" text,
	"as_of" timestamp with time zone,
	"period_start" date,
	"period_end" date,
	"rows_read" integer NOT NULL,
	"rows_used" integer NOT NULL,
	"skus_matched" integer NOT NULL,
	"rows_skipped" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fba_inventory_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"fulfillable" integer NOT NULL,
	"reserved" integer NOT NULL,
	"unsellable" integer NOT NULL,
	"inbound_working" integer NOT NULL,
	"inbound_shipped" integer NOT NULL,
	"inbound_receiving" integer NOT NULL,
	"researching" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fba_ledger_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku_id" integer NOT NULL,
	"day" date NOT NULL,
	"event_type" text NOT NULL,
	"disposition" text NOT NULL,
	"quantity" integer NOT NULL,
	"import_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amazon_imports" ADD CONSTRAINT "amazon_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fba_inventory_snapshots" ADD CONSTRAINT "fba_inventory_snapshots_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fba_inventory_snapshots" ADD CONSTRAINT "fba_inventory_snapshots_import_id_amazon_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."amazon_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fba_ledger_daily" ADD CONSTRAINT "fba_ledger_daily_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fba_ledger_daily" ADD CONSTRAINT "fba_ledger_daily_import_id_amazon_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."amazon_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amazon_imports_kind_idx" ON "amazon_imports" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "fba_inventory_snapshots_sku_idx" ON "fba_inventory_snapshots" USING btree ("sku_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "fba_ledger_daily_key" ON "fba_ledger_daily" USING btree ("sku_id","day","event_type","disposition");--> statement-breakpoint
CREATE INDEX "fba_ledger_daily_day_idx" ON "fba_ledger_daily" USING btree ("day");