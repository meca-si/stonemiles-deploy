-- Accounting sync + recruiting ATS-lite.
-- PG twin of drizzle/0136_accounting_recruiting.sql — see that
-- file's header. accounting_connections (OAuth tokens
-- server-side only), accounting_sync_records (per-record sync
-- idempotency ledger), recruiting_doors (a fleet's public
-- application door), driver_applications (desk-only),
-- driver_application_notes (fleet-internal).
CREATE TABLE "accounting_connections" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"realm_id" text,
	"display_label" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"oauth_state" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"inbound_cursor" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "accounting_sync_records" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" integer,
	"provider_object_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"local_stamp" text,
	"provider_stamp" text,
	"local_snapshot_json" text,
	"provider_snapshot_json" text,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "recruiting_doors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"token" text NOT NULL,
	"response_subject" text,
	"response_body" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "driver_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"door_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"cdl_class" text NOT NULL,
	"experience" text NOT NULL,
	"note" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"response_status" text DEFAULT 'queued' NOT NULL,
	"response_at" timestamp with time zone,
	"invite_code_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "driver_application_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
