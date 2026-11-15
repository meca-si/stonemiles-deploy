-- Autonomy core. PG twin of drizzle/0129_autonomy_core.sql — see
-- that file's header. status_outbox is the syndication feed of
-- record (no rate/money column by design; corrections supersede),
-- auto_exceptions holds the per-role exception queues with their
-- sealed resolutions.
CREATE TABLE "status_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"chain_hash" text,
	"dedupe_key" text NOT NULL,
	"supersedes_id" integer,
	"superseded_by_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"kind" text NOT NULL,
	"severity" integer DEFAULT 1 NOT NULL,
	"detail" text NOT NULL,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"driver_username" text NOT NULL,
	"company_id" integer,
	"broker_account_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolution_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"chain_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
