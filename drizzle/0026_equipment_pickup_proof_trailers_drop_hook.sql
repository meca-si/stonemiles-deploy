ALTER TABLE `profile` ADD COLUMN `current_trailer` text;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `trailer_number` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `equipment_type` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `trailer_number` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `seal_entered` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `seal_bol` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `seal_status` text;
--> statement-breakpoint
CREATE TABLE `pickup_extra_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`blob_key` text NOT NULL,
	`mime` text NOT NULL,
	`sha256` text NOT NULL,
	`captured_at` integer NOT NULL,
	`lat` real,
	`lon` real,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trailer_swaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`trailer_number` text NOT NULL,
	`dropper_username` text NOT NULL,
	`receiver_kind` text NOT NULL,
	`receiver_username` text,
	`receiver_name` text,
	`receiver_company` text,
	`status` text NOT NULL,
	`drop_blob_key` text NOT NULL,
	`drop_mime` text NOT NULL,
	`drop_sha256` text NOT NULL,
	`drop_captured_at` integer NOT NULL,
	`drop_lat` real,
	`drop_lon` real,
	`drop_city` text,
	`drop_state` text,
	`drop_location_source` text NOT NULL,
	`hook_blob_key` text,
	`hook_mime` text,
	`hook_sha256` text,
	`hook_captured_at` integer,
	`hook_lat` real,
	`hook_lon` real,
	`hook_city` text,
	`hook_state` text,
	`hook_location_source` text,
	`hook_username` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
