CREATE TABLE `weigh_station_status` (
	`station_id` text PRIMARY KEY NOT NULL,
	`station_name` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`status` text NOT NULL,
	`reporter` text NOT NULL,
	`report_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weigh_station_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`station_name` text NOT NULL,
	`status` text NOT NULL,
	`reporter` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`station_lat` real NOT NULL,
	`station_lon` real NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`points_awarded` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `weigh_prompts` integer DEFAULT true NOT NULL;
