-- Driver Calendar (Research Wave 2 item 10.5, 2026-11-15) — one
-- calendar per driver: every bound load, off-duty blocks,
-- paydays, credential expiries; the desk reads the same week as
-- a fleet grid. fleet_calendar_settings is the owner's per-fleet
-- settings: dispatch_mode (offered = the pre-calendar board
-- behaviour, until the owner picks assigned = forced dispatch),
-- the safety window (decline cutoff hours before pickup,
-- default 24), and the pay cycle that projects payday markers
-- (none until the owner states one — never invented).
-- off_duty_requests are typed blocks (home_time | medical |
-- family | personal | reset) with the desk's decision kept;
-- an approved request carries commitment_id — the
-- home_time_commitments shadow the item-9 gate enforces.
-- load_release_requests are a driver's ask to be released from
-- a load LOCKED inside the safety window; the desk decides.
-- load_reassignments move a bound load only with the current
-- driver's consent; a refusal can be overridden only by the
-- fleet owner, with a stated reason, on the row. NO rate or
-- money column exists on any of these tables by design.
CREATE TABLE `fleet_calendar_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`dispatch_mode` text DEFAULT 'offered' NOT NULL,
	`safety_window_hours` integer DEFAULT 24 NOT NULL,
	`pay_cycle_kind` text DEFAULT 'none' NOT NULL,
	`pay_weekday` integer,
	`pay_anchor_on` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fleet_calendar_settings_company_id_unique` ON `fleet_calendar_settings` (`company_id`);
--> statement-breakpoint
CREATE TABLE `off_duty_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`driver_username` text NOT NULL,
	`type` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`decided_at` integer,
	`commitment_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `load_release_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`board_load_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `load_reassignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`board_load_id` integer NOT NULL,
	`from_driver` text NOT NULL,
	`to_driver` text NOT NULL,
	`proposed_by` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending_consent' NOT NULL,
	`responded_at` integer,
	`override_by` text,
	`override_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_load_handbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`board_load_id` integer NOT NULL,
	`load_id` integer,
	`trip_queue_id` integer,
	`reason` text NOT NULL,
	`swept_at` integer,
	`created_at` integer NOT NULL
);
