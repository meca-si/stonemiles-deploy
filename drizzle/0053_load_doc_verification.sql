CREATE TABLE `load_doc_extractions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`side` text NOT NULL,
	`source` text NOT NULL,
	`doc_sha256` text,
	`found` integer DEFAULT 0 NOT NULL,
	`fields_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `load_doc_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`run_by` text NOT NULL,
	`verdict` text NOT NULL,
	`report_json` text NOT NULL,
	`outcomes_hash` text NOT NULL,
	`ratecon_sha256` text,
	`bol_sha256` text,
	`chain_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `load_doc_exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`field` text NOT NULL,
	`field_label` text NOT NULL,
	`ratecon_value` text,
	`bol_value` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_by_run` integer,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`close_kind` text,
	`close_reason` text
);
