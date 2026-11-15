-- Video coaching + predictive maintenance + smart trailer.
-- PG twin of drizzle/0137_video_maintenance_trailer.sql — see
-- that file's header. dashcam_connections (webhook secret
-- server-side only), dashcam_events (clip references, never
-- video bytes), exoneration_vault_entries (pinned evidence
-- packets), fault_reports (codes recorded as reported; unknown
-- codes keep meaning NULL / urgency "unknown"),
-- trailer_connections (device pairing), trailer_readings (GPS /
-- reefer readings against sealed loads).
CREATE TABLE "dashcam_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"created_by" text NOT NULL,
	"label" text NOT NULL,
	"provider" text,
	"webhook_secret" text,
	"secret_last4" text,
	"driver_username" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "dashcam_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer,
	"company_id" integer,
	"driver_username" text NOT NULL,
	"partner_event_id" text,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'unspecified' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"clip_ref" text NOT NULL,
	"clip_url" text,
	"load_id" integer,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "exoneration_vault_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"load_id" integer,
	"company_id" integer,
	"driver_username" text NOT NULL,
	"packet_ref" text NOT NULL,
	"evidence_json" text DEFAULT '{}' NOT NULL,
	"evidence_hash" text,
	"pinned_by" text NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "fault_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_username" text NOT NULL,
	"company_id" integer,
	"code" text NOT NULL,
	"source" text NOT NULL,
	"source_note" text,
	"meaning" text,
	"urgency" text DEFAULT 'unknown' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"odometer" double precision,
	"engine_hours" double precision,
	"maintenance_entry_id" integer,
	"dedupe_key" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "trailer_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"created_by" text NOT NULL,
	"driver_username" text NOT NULL,
	"label" text NOT NULL,
	"device_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "trailer_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer,
	"company_id" integer,
	"driver_username" text NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"temp_f" double precision,
	"load_id" integer,
	"source" text DEFAULT 'partner' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
