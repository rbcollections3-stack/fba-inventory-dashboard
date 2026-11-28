CREATE TABLE "amazon_sync_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "amazon_report_kind" NOT NULL,
	"report_type" text NOT NULL,
	"amazon_report_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"data_start" timestamp with time zone,
	"data_end" timestamp with time zone,
	"message" text,
	"import_id" integer,
	"requested_by" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "amazon_sync_requests_status_valid" CHECK ("amazon_sync_requests"."status" in ('requested', 'saved', 'no_data', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "amazon_sync_requests" ADD CONSTRAINT "amazon_sync_requests_import_id_amazon_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."amazon_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amazon_sync_requests" ADD CONSTRAINT "amazon_sync_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amazon_sync_requests_one_waiting" ON "amazon_sync_requests" USING btree ("kind") WHERE "amazon_sync_requests"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "amazon_sync_requests_kind_idx" ON "amazon_sync_requests" USING btree ("kind","requested_at");