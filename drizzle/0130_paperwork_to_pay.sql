-- Paperwork-to-pay (Research Wave 2 item 2, 2026-11-15).
-- load_paperwork: one row per (load, document kind) — the scanned
-- BOL or POD a driver attaches to a load, and the state of its
-- trip through the pipeline: filed → read (extraction attempted)
-- → confirmed by the driver → POD copy sent to the broker/factor
-- → invoice cut. The document bytes live in the vault blob store
-- (blob_key); this row is the pipeline ledger. NO rate or money
-- column exists here by design — the invoice carries the money,
-- this table carries the paperwork state. Shared table (no
-- profile_id): the load's driver writes it; the fleet desk and
-- the outward track page read the status through the same row,
-- gated in actions.ts. (load_id, doc_kind) uniqueness is kept by
-- the intake upsert.
CREATE TABLE `load_paperwork` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`doc_kind` text NOT NULL,
	`driver_username` text NOT NULL,
	`blob_key` text NOT NULL,
	`mime` text NOT NULL,
	`sha256` text NOT NULL,
	`filed_by` text NOT NULL,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`candidate_fields_json` text,
	`extraction_at` integer,
	`confirm_status` text DEFAULT 'unconfirmed' NOT NULL,
	`confirmed_fields_json` text,
	`confirmed_by` text,
	`confirmed_at` integer,
	`recipient_email` text,
	`recipient_label` text,
	`send_status` text DEFAULT 'not_ready' NOT NULL,
	`send_at` integer,
	`send_provider_id` text,
	`invoice_id` integer,
	`invoice_auto_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
