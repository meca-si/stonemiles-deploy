CREATE TABLE `totp_credentials` (
	`username` text PRIMARY KEY NOT NULL,
	`secret_enc` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`device_id` text NOT NULL,
	`device_label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `security_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_locks` (
	`username` text PRIMARY KEY NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`locked_at` integer,
	`reason` text
);
--> statement-breakpoint
CREATE TABLE `stepup_state` (
	`username` text PRIMARY KEY NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `record_access_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`viewer_username` text NOT NULL,
	`subject_username` text NOT NULL,
	`kind` text NOT NULL,
	`what` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_positions` (
	`username` text PRIMARY KEY NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_prefs` (
	`username` text PRIMARY KEY NOT NULL,
	`auto_lock_minutes` integer DEFAULT 0 NOT NULL,
	`track_retention_days` integer DEFAULT 30 NOT NULL,
	`last_purge_at` integer
);
--> statement-breakpoint
CREATE TABLE `money_holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`amount_stoner` real NOT NULL,
	`points` integer,
	`reason` text NOT NULL,
	`status` text DEFAULT 'review_hold' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `company_members` ADD COLUMN `login_disabled` integer DEFAULT false NOT NULL;
