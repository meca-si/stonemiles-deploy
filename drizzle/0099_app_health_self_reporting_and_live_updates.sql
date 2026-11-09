CREATE TABLE `app_health_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_report_enabled` integer DEFAULT true NOT NULL,
	`last_check_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_health_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`screen` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`diagnosis` text,
	`fix_plan` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_health_reports_fingerprint_unique` ON `app_health_reports` (`fingerprint`);
--> statement-breakpoint
CREATE TABLE `app_live_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`report_id` integer,
	`created_at` integer NOT NULL
);
