-- My Truck identity + maintenance log (x's order, 2026-11-14:
-- "add their truck model and specs" + "maintenance log with repair
-- receipt and paperwork upload and able to download to a file...
-- that way you can keep all records of the truck").
-- (1) Eight identity columns on the profile row — year, make, model,
-- unit number, VIN, plate, engine, transmission — all optional, typed
-- in by the driver in Settings -> Truck, riding the same save path as
-- the truck dimensions. Until now make/model/year only ever arrived
-- read-only on an ELD snapshot; a driver with no ELD had nowhere to
-- put the truck itself.
-- (2) maintenance_log_entries: one row per service/repair event on
-- that truck (date, odometer, category, description, shop, cost,
-- next-due miles/date, notes) — the full record beside the existing
-- interval countdown, which keeps its own table untouched.
-- (3) maintenance_log_attachments: receipt/paperwork files per entry;
-- the file bytes live in the same blob store the Document Vault uses
-- (blob_key + mime on the row), so each attachment downloads
-- individually the same way a vault document does.
ALTER TABLE `profile` ADD COLUMN `truck_year` integer;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_make` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_model` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_unit_number` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_vin` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_plate` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_engine` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `truck_transmission` text;
--> statement-breakpoint
CREATE TABLE `maintenance_log_entries` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`performed_at` integer NOT NULL,
	`odometer` real,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`shop` text,
	`cost` real DEFAULT 0 NOT NULL,
	`next_due_miles` real,
	`next_due_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_log_attachments` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`label` text NOT NULL,
	`blob_key` text,
	`mime` text,
	`created_at` integer NOT NULL
);
