ALTER TABLE `app_settings` ADD COLUMN `map_show_signals` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE `work_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`note` text,
	`reporter` text,
	`confirm_count` integer DEFAULT 0 NOT NULL,
	`gone_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_confirmed_at` integer
);
