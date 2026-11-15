-- Offline mode + ELD sync + push plumbing (TMS completion queue
-- items 7–9, 2026-11-15).
-- offline_captures: the sync ledger for records captured with no
-- signal (duty changes, signed DVIRs). One row per (driver, client
-- capture id) — the composite PK is the idempotency key that makes
-- a re-sync return the original seal instead of duplicating the
-- record. chain_hash is the chain entry the capture sealed as;
-- result_json carries the DVIR sync result for duplicate syncs.
CREATE TABLE `offline_captures` (
	`username` text NOT NULL,
	`capture_id` text NOT NULL,
	`kind` text NOT NULL,
	`chain_hash` text,
	`result_json` text,
	`captured_at` integer NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`username`, `capture_id`)
);
--> statement-breakpoint
-- notifications: the in-app notification center's rows — DM /
-- dispatch messages, load offers, credential alerts, HOS warnings,
-- recorded by the event producers with per-kind dedupe (see
-- notifications.ts). push_state is the honest device-push outcome
-- (no_devices | not_configured | sent | failed); FCM delivery
-- wires in with the Android build. No email is ever sent for these.
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`dedupe_key` text,
	`ref_kind` text,
	`ref_id` integer,
	`count` integer DEFAULT 1 NOT NULL,
	`push_state` text DEFAULT 'not_configured' NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- push_devices: FCM device-token registrations the Android build
-- will fan notifications out to. The token is the PK (a token
-- belongs to one user at a time; re-registering moves it).
CREATE TABLE `push_devices` (
	`token` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`platform` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer
);
