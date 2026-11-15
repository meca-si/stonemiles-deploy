-- DVIR completion + detention timer. PG twin of
-- drizzle/0122_dvir_detention.sql — see that file's header.
-- dvir_reports signing-time facts (GPS, identity snapshot,
-- safe-to-operate), maintenance_log_entries workflow status,
-- dvir_defect_links, and detention_records (time only, no money).
ALTER TABLE "dvir_reports" ADD COLUMN "lat" double precision;
--> statement-breakpoint
ALTER TABLE "dvir_reports" ADD COLUMN "lon" double precision;
--> statement-breakpoint
ALTER TABLE "dvir_reports" ADD COLUMN "truck_label" text;
--> statement-breakpoint
ALTER TABLE "dvir_reports" ADD COLUMN "trailer_label" text;
--> statement-breakpoint
ALTER TABLE "dvir_reports" ADD COLUMN "safe_to_operate" boolean;
--> statement-breakpoint
ALTER TABLE "maintenance_log_entries" ADD COLUMN "status" text DEFAULT 'logged' NOT NULL;
--> statement-breakpoint
CREATE TABLE "dvir_defect_links" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"dvir_id" integer NOT NULL,
	"item" text NOT NULL,
	"maintenance_entry_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detention_records" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer,
	"site" text NOT NULL,
	"place_label" text,
	"appt_at" timestamp with time zone,
	"grace_minutes" integer DEFAULT 120 NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"departed_at" timestamp with time zone,
	"arrive_lat" double precision,
	"arrive_lon" double precision,
	"depart_lat" double precision,
	"depart_lon" double precision,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
