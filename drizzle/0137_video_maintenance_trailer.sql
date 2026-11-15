-- Video coaching + predictive maintenance + smart trailer
-- (Research Wave 2 item 11, 2026-11-15) — dashcam_connections
-- holds a fleet's dashcam partner webhook door: the shared
-- secret lives ONLY in that row, server-side (shown once at
-- creation, last-4 after; revoking wipes it). dashcam_events
-- are the coaching records — the partner hosts the video; the
-- row holds the clip REFERENCE, never bytes. exoneration_vault_
-- entries pin an event plus its sealed evidence snapshot as one
-- Library packet (ref exoneration:{id}); removal is explicit
-- (removed_at / removed_by), never automatic. fault_reports
-- record each fault code exactly as reported — meaning/urgency
-- are the faultCodes.ts lookup snapshot, NULL/"unknown" for
-- codes the table doesn't know; maintenance_entry_id links the
-- work-order draft a stop-now/service-soon code auto-created.
-- trailer_connections pair a telematics device to a driver (the
-- trailer itself stays the My Trailer record); trailer_readings
-- are its GPS / reefer readings, reefer rows carrying the sealed
-- load they were taken under. All six tables scope by their own
-- company_id / driver_username columns (the DQF pattern) — the
-- dashcam webhook intake has no driver session to host-stamp.
CREATE TABLE `dashcam_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`created_by` text NOT NULL,
	`label` text NOT NULL,
	`provider` text,
	`webhook_secret` text,
	`secret_last4` text,
	`driver_username` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashcam_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer,
	`company_id` integer,
	`driver_username` text NOT NULL,
	`partner_event_id` text,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'unspecified' NOT NULL,
	`occurred_at` integer NOT NULL,
	`clip_ref` text NOT NULL,
	`clip_url` text,
	`load_id` integer,
	`note` text,
	`status` text DEFAULT 'new' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`simulated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exoneration_vault_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`load_id` integer,
	`company_id` integer,
	`driver_username` text NOT NULL,
	`packet_ref` text NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`evidence_hash` text,
	`pinned_by` text NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fault_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`driver_username` text NOT NULL,
	`company_id` integer,
	`code` text NOT NULL,
	`source` text NOT NULL,
	`source_note` text,
	`meaning` text,
	`urgency` text DEFAULT 'unknown' NOT NULL,
	`occurred_at` integer NOT NULL,
	`odometer` real,
	`engine_hours` real,
	`maintenance_entry_id` integer,
	`dedupe_key` text,
	`simulated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trailer_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`created_by` text NOT NULL,
	`driver_username` text NOT NULL,
	`label` text NOT NULL,
	`device_ref` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trailer_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer,
	`company_id` integer,
	`driver_username` text NOT NULL,
	`kind` text NOT NULL,
	`lat` real,
	`lon` real,
	`temp_f` real,
	`load_id` integer,
	`source` text DEFAULT 'partner' NOT NULL,
	`recorded_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
