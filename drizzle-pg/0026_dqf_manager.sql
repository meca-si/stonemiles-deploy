-- Driver qualification file (DQF) manager.
-- PG twin of drizzle/0133_dqf_manager.sql — see that file's
-- header. dqf_files (the folder per company+driver), dqf_entries
-- (the recorded 391 facts; standing is derived, never stored),
-- dqf_alert_dismissals (fleet-side expiry alert dismissals keyed
-- on item + threshold + date).
CREATE TABLE "dqf_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "dqf_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"kind" text NOT NULL,
	"entry_date" text NOT NULL,
	"expires_on" text,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"doc_blob_key" text,
	"doc_mime" text,
	"recorded_by" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "dqf_alert_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"item_key" text NOT NULL,
	"threshold" integer NOT NULL,
	"expires_on" text NOT NULL,
	"dismissed_by" text NOT NULL,
	"dismissed_at" timestamp with time zone NOT NULL
);
