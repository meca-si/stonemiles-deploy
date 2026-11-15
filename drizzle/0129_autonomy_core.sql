-- Autonomy core (Research Wave 2 item 1, 2026-11-15).
-- status_outbox: the syndication feed of record — one row per
-- auto-status the evaluator published for a load (milestone, plain
-- summary, evidence JSON, confidence). NO rate or money column
-- exists here by design. A void writes a kind='correction' row
-- that supersedes the original (supersedes_id / superseded_by_id
-- pair); outward surfaces render only un-superseded rows. This is
-- an in-app feed — no partner feed is connected, nothing is
-- POSTed anywhere.
CREATE TABLE `status_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`chain_hash` text,
	`dedupe_key` text NOT NULL,
	`supersedes_id` integer,
	`superseded_by_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
-- auto_exceptions: one row per exception episode in the autonomy
-- exception queues (driver / fleet / broker audiences routed by
-- driver_username / company_id / broker_account_id). Resolution is
-- sealed into the chain (exception_resolved); chain_hash rides
-- here. dedupe_key keeps one OPEN row per (load, kind).
CREATE TABLE `auto_exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`kind` text NOT NULL,
	`severity` integer DEFAULT 1 NOT NULL,
	`detail` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`driver_username` text NOT NULL,
	`company_id` integer,
	`broker_account_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolution_note` text,
	`resolved_by` text,
	`resolved_at` integer,
	`dedupe_key` text NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`chain_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
