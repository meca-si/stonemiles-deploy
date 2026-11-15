-- Paperwork-to-pay. PG twin of drizzle/0130_paperwork_to_pay.sql —
-- see that file's header. load_paperwork is the pipeline ledger
-- for a load's scanned BOL/POD (filed → read → confirmed → sent →
-- invoiced); no rate or money column exists on it by design.
CREATE TABLE "load_paperwork" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"doc_kind" text NOT NULL,
	"driver_username" text NOT NULL,
	"blob_key" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"filed_by" text NOT NULL,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"candidate_fields_json" text,
	"extraction_at" timestamp with time zone,
	"confirm_status" text DEFAULT 'unconfirmed' NOT NULL,
	"confirmed_fields_json" text,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"recipient_email" text,
	"recipient_label" text,
	"send_status" text DEFAULT 'not_ready' NOT NULL,
	"send_at" timestamp with time zone,
	"send_provider_id" text,
	"invoice_id" integer,
	"invoice_auto_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
