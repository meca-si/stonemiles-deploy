CREATE TABLE `road_place_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text NOT NULL,
	`place_kind` text NOT NULL,
	`reporter` text NOT NULL,
	`reporter_lat` real NOT NULL,
	`reporter_lon` real NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `road_place_hides` (
	`place_id` text NOT NULL,
	`username` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`place_id`, `username`)
);
--> statement-breakpoint
CREATE TABLE `road_place_retired` (
	`place_id` text PRIMARY KEY NOT NULL,
	`place_kind` text NOT NULL,
	`reason` text NOT NULL,
	`correction_count` integer DEFAULT 0 NOT NULL,
	`retired_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `intel_reports` ADD COLUMN `reporter` text;
