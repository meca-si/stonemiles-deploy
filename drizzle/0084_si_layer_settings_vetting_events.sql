CREATE TABLE `si_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rules_version` text DEFAULT '2026-11-01' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `si_vetting_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_name` text,
	`mc_number` text,
	`dot_number` text,
	`board_load_id` integer,
	`load_id` integer,
	`verdict` text NOT NULL,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`safer_url` text,
	`summary` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `si_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`dedupe_key` text,
	`ref_kind` text,
	`ref_id` integer,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `si_events_dedupe_key_unique` ON `si_events` (`dedupe_key`);
