UPDATE `profile` SET `plan` = 'basic' WHERE `plan` = 'simple';
--> statement-breakpoint
UPDATE `profile` SET `plan` = 'diamond' WHERE `plan` = 'full';
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `label` text;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `queue_id` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `trip_queue_id` integer;
--> statement-breakpoint
CREATE TABLE `trip_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`origin` text,
	`destination` text,
	`status` text NOT NULL DEFAULT 'planned',
	`load_id` integer,
	`notes` text,
	`pay_rate` real NOT NULL DEFAULT 0.55,
	`stops_json` text NOT NULL DEFAULT '[]',
	`route_label` text,
	`started_at` integer,
	`ended_at` integer,
	`completed_trip_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
