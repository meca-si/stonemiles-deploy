ALTER TABLE `profile` ADD COLUMN `trailer_type` text DEFAULT 'dry_van' NOT NULL;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `loaded_height_in` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `reefer_setpoint_f` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `reefer_band_f` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `dock_appt_at` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `dock_door` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `lumper_fee` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `lumper_receipt_blob_key` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `lumper_receipt_mime` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `lumper_receipt_sha256` text;
--> statement-breakpoint
CREATE TABLE `reefer_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`temp_f` real NOT NULL,
	`lat` real,
	`lon` real,
	`note` text,
	`chain_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pretrip_inspections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer,
	`trailer_type` text NOT NULL,
	`items_json` text NOT NULL,
	`defect_count` integer DEFAULT 0 NOT NULL,
	`photo_blob_key` text,
	`photo_mime` text,
	`photo_sha256` text,
	`lat` real,
	`lon` real,
	`chain_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
