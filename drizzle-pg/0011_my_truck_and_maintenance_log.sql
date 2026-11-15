-- My Truck identity + maintenance log. PG twin of
-- drizzle/0118_my_truck_and_maintenance_log.sql — see that file's
-- header. Eight truck-identity columns on profile, the maintenance
-- log entries table, and its receipt/paperwork attachments table
-- (file bytes in the same blob store as the Document Vault).
ALTER TABLE "profile" ADD COLUMN "truck_year" integer;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_make" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_model" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_unit_number" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_vin" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_plate" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_engine" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "truck_transmission" text;
--> statement-breakpoint
CREATE TABLE "maintenance_log_entries" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"odometer" double precision,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"shop" text,
	"cost" double precision DEFAULT 0 NOT NULL,
	"next_due_miles" double precision,
	"next_due_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_log_attachments" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"label" text NOT NULL,
	"blob_key" text,
	"mime" text,
	"created_at" timestamp with time zone NOT NULL
);
