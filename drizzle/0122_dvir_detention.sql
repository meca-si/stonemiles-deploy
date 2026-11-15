-- DVIR completion + detention timer (x's build order, 2026-11-15;
-- spec: dvir-detention-spec-2026-11-15.md).
-- (1) dvir_reports gains the signing-time facts the spec requires:
-- GPS lat/lon, the truck/trailer identity snapshot from My Truck /
-- My Trailer (identity changes later never rewrite a signed record),
-- and the driver's safe-to-operate attestation.
-- (2) maintenance_log_entries gains a workflow status: "logged"
-- (normal), "draft" (auto-created from a signed DVIR defect, awaiting
-- the driver's confirm), "closed" (work done). Existing rows default
-- to "logged".
-- (3) dvir_defect_links ties each DVIR defect to the maintenance
-- draft it created; a defect is open until that entry is closed.
-- (4) detention_records: one row per detention-timer visit (ARRIVE
-- opens, DONE closes + seals). Appointment + grace snapshot at
-- ARRIVE. Time only — no rate/money column by design.
ALTER TABLE `dvir_reports` ADD COLUMN `lat` real;
--> statement-breakpoint
ALTER TABLE `dvir_reports` ADD COLUMN `lon` real;
--> statement-breakpoint
ALTER TABLE `dvir_reports` ADD COLUMN `truck_label` text;
--> statement-breakpoint
ALTER TABLE `dvir_reports` ADD COLUMN `trailer_label` text;
--> statement-breakpoint
ALTER TABLE `dvir_reports` ADD COLUMN `safe_to_operate` integer;
--> statement-breakpoint
ALTER TABLE `maintenance_log_entries` ADD COLUMN `status` text DEFAULT 'logged' NOT NULL;
--> statement-breakpoint
CREATE TABLE `dvir_defect_links` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dvir_id` integer NOT NULL,
	`item` text NOT NULL,
	`maintenance_entry_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `detention_records` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer,
	`site` text NOT NULL,
	`place_label` text,
	`appt_at` integer,
	`grace_minutes` integer DEFAULT 120 NOT NULL,
	`arrived_at` integer NOT NULL,
	`departed_at` integer,
	`arrive_lat` real,
	`arrive_lon` real,
	`depart_lat` real,
	`depart_lon` real,
	`chain_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
