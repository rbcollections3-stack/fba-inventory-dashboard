ALTER TYPE "public"."count_source" ADD VALUE 'shipment';--> statement-breakpoint
CREATE TABLE "shipment_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"sku_id" integer NOT NULL,
	"cases" integer NOT NULL,
	"units_per_case" integer NOT NULL,
	"tie" integer NOT NULL,
	"high" integer NOT NULL,
	"max_cases_per_pallet" integer NOT NULL,
	CONSTRAINT "shipment_lines_cases_positive" CHECK ("shipment_lines"."cases" > 0),
	CONSTRAINT "shipment_lines_units_per_case_positive" CHECK ("shipment_lines"."units_per_case" > 0),
	CONSTRAINT "shipment_lines_tie_positive" CHECK ("shipment_lines"."tie" > 0),
	CONSTRAINT "shipment_lines_high_positive" CHECK ("shipment_lines"."high" > 0),
	CONSTRAINT "shipment_lines_max_cases_positive" CHECK ("shipment_lines"."max_cases_per_pallet" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"amazon_shipment_id" text,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" integer,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	CONSTRAINT "shipments_status_valid" CHECK ("shipments"."status" in ('requested', 'sent', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "warehouse_counts" ADD COLUMN "shipment_id" integer;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_lines_sku_key" ON "shipment_lines" USING btree ("shipment_id","sku_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_sku_idx" ON "shipment_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "warehouse_counts" ADD CONSTRAINT "warehouse_counts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;