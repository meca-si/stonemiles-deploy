-- Maintenance Sheet (2026-11-24, x's order).
-- PG twin of drizzle/0143_maintenance_sheet.sql — see that file's
-- header. maintenance_log_entries gains kind / parts_json /
-- oil_brand / oil_weight; maintenance_fleet_records is the new
-- share-up fleet-copy table.
ALTER TABLE "maintenance_log_entries" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;
--> statement-breakpoint
ALTER TABLE "maintenance_log_entries" ADD COLUMN "parts_json" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "maintenance_log_entries" ADD COLUMN "oil_brand" text;
--> statement-breakpoint
ALTER TABLE "maintenance_log_entries" ADD COLUMN "oil_weight" text;
--> statement-breakpoint
CREATE TABLE "maintenance_fleet_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"username" text NOT NULL,
	"entry_id" integer NOT NULL,
	"truck_unit" text,
	"truck_label" text,
	"kind" text DEFAULT 'service' NOT NULL,
	"category" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"odometer" double precision,
	"description" text NOT NULL,
	"shop" text,
	"cost" double precision DEFAULT 0 NOT NULL,
	"parts_json" text DEFAULT '[]' NOT NULL,
	"oil_brand" text,
	"oil_weight" text,
	"next_due_miles" double precision,
	"next_due_at" timestamp with time zone,
	"published_at" timestamp with time zone NOT NULL
);
