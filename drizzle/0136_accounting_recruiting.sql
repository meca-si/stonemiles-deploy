-- Accounting sync + recruiting ATS-lite (Research Wave 2
-- item 10, 2026-11-15) — accounting_connections holds a
-- driver's QuickBooks Online / Xero OAuth connection: tokens
-- live ONLY in that row, server-side; no action returns them
-- and no chain payload carries them (the panel shows a masked
-- "connected as <label>" line). accounting_sync_records is the
-- per-record idempotency ledger of the two-way sync (states
-- pending | synced | conflict | error | review | resolved,
-- with both mapped snapshots kept for the review panel).
-- recruiting_doors is a fleet's public driver-application door
-- (company-scoped like driver_codes; the token is the whole
-- credential, as with the broker door). driver_applications
-- land in the fleet's desk only; driver_application_notes are
-- fleet-internal and never applicant-visible. "Hired" mints a
-- driver_codes row (invite_code_id) through the existing code
-- flow — no new account path.
CREATE TABLE `accounting_connections` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`realm_id` text,
	`display_label` text,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` integer,
	`oauth_state` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`inbound_cursor` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_sync_records` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`record_kind` text NOT NULL,
	`record_id` integer,
	`provider_object_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`local_stamp` text,
	`provider_stamp` text,
	`local_snapshot_json` text,
	`provider_snapshot_json` text,
	`last_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recruiting_doors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`created_by` text NOT NULL,
	`token` text NOT NULL,
	`response_subject` text,
	`response_body` text,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`door_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`cdl_class` text NOT NULL,
	`experience` text NOT NULL,
	`note` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`response_status` text DEFAULT 'queued' NOT NULL,
	`response_at` integer,
	`invite_code_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_application_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
