ALTER TABLE `app_settings` ADD COLUMN `winter_weather_alerts` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE `hazard_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
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
