-- Home-time guarantee + retention (Research Wave 2 item 9,
-- 2026-11-15) — home_time_commitments is a term the DRIVER
-- stated (or their fleet stated for them): by_date (home by one
-- instant), every_n_days (a cadence anchored on a known home
-- deadline), or weekends (home by Saturday 00:00 UTC). Corrected
-- by voiding + re-recording, never edited. home_time_overrides
-- is one row per knowing break at a binding funnel (claim /
-- assign / accept) — named person, stated reason, and the math
-- that was shown; every row is chain-sealed at write time.
-- Whether a deadline was KEPT is derived from the sealed record
-- (duty spells at home, delivery seals, these overrides) by the
-- pure rules in homeTime.ts — no outcome is stored as a claim.
-- pulse_responses is one row per driver per 14-day pulse
-- episode (answered or dismissed); a driver's answers are their
-- own record — the fleet sees aggregates only, and only when
-- 3+ drivers answered in the window. home_time_fact_snapshots
-- carries the two retention fact counts that live in
-- profile-scoped tables (detention overruns, trip miles) from
-- the driver's own session to their fleet's desk, stamped with
-- when they were computed.
CREATE TABLE `home_time_commitments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`kind` text NOT NULL,
	`home_by_at` integer,
	`every_n_days` integer,
	`anchor_at` integer,
	`set_by` text NOT NULL,
	`created_by` text NOT NULL,
	`note` text,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`voided_at` integer,
	`voided_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `home_time_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`commitment_id` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	`board_load_id` integer NOT NULL,
	`load_id` integer,
	`method` text NOT NULL,
	`overridden_by` text NOT NULL,
	`reason` text NOT NULL,
	`delivery_at` integer,
	`home_eta_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pulse_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`episode_key` text NOT NULL,
	`status` text NOT NULL,
	`answers_json` text DEFAULT '{}' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `home_time_fact_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`detention_overruns90` integer DEFAULT 0 NOT NULL,
	`miles_recent30` real DEFAULT 0 NOT NULL,
	`miles_prior30` real DEFAULT 0 NOT NULL,
	`computed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
