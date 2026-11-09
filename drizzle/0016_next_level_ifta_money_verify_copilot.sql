ALTER TABLE `profile` ADD COLUMN `hazmat` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `hazmat_class` text;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `language` text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `hazmat` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `fuel_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchased_at` integer NOT NULL,
	`state` text NOT NULL,
	`station` text,
	`gallons` real NOT NULL,
	`price_per_gallon` real NOT NULL,
	`total` real NOT NULL,
	`odometer` real,
	`receipt_blob_key` text,
	`receipt_mime` text,
	`receipt_sha256` text,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`spent_at` integer NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`vendor` text,
	`state` text,
	`load_id` integer,
	`notes` text,
	`receipt_blob_key` text,
	`receipt_mime` text,
	`receipt_sha256` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`carrier` text,
	`period_label` text,
	`gross` real,
	`net` real,
	`lines_json` text NOT NULL DEFAULT '[]',
	`doc_blob_key` text,
	`doc_mime` text,
	`doc_sha256` text,
	`check_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scale_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weighed_at` integer NOT NULL,
	`location` text,
	`state` text,
	`steer_lbs` integer,
	`drive_lbs` integer,
	`trailer_lbs` integer,
	`gross_lbs` integer,
	`load_id` integer,
	`photo_blob_key` text,
	`photo_mime` text,
	`photo_sha256` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personal_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`expires_at` integer,
	`doc_number_last4` text,
	`notes` text,
	`blob_key` text,
	`mime` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verify_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer,
	`record_hash` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verify_codes_code_unique` ON `verify_codes` (`code`);
--> statement-breakpoint
CREATE TABLE `dvir_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inspected_at` integer NOT NULL,
	`kind` text NOT NULL DEFAULT 'pretrip',
	`items_json` text NOT NULL DEFAULT '[]',
	`defects_json` text NOT NULL DEFAULT '[]',
	`signed_name` text NOT NULL,
	`status` text NOT NULL DEFAULT 'signed',
	`odometer` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passport_prefs` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`show_miles` integer DEFAULT 1 NOT NULL,
	`show_on_time` integer DEFAULT 1 NOT NULL,
	`show_safety` integer DEFAULT 1 NOT NULL,
	`show_seasons` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
