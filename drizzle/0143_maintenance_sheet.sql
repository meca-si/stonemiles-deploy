-- Maintenance Sheet (2026-11-24, x's order): the maintenance log
-- gains the record KIND (scheduled service / PM vs an unscheduled
-- repair that came up), the parts used (JSON [{name, partNumber}]),
-- and the oil brand + weight for oil changes — the fields a
-- carrier-sendable maintenance sheet prints. Existing rows read
-- kind "service" with an empty parts list.
ALTER TABLE `maintenance_log_entries` ADD COLUMN `kind` text DEFAULT 'service' NOT NULL;
--> statement-breakpoint
ALTER TABLE `maintenance_log_entries` ADD COLUMN `parts_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `maintenance_log_entries` ADD COLUMN `oil_brand` text;
--> statement-breakpoint
ALTER TABLE `maintenance_log_entries` ADD COLUMN `oil_weight` text;
--> statement-breakpoint
-- The share-up fleet copies: one row per (company, driver, entry)
-- the driver's app publishes when a company driver saves a log
-- entry, read by that company's owner + dispatch seats. No
-- profile_id — company tables are the cross-profile pipe (the
-- driver_fleet_status pattern); reads gate on membership + role
-- in the action.
CREATE TABLE `maintenance_fleet_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`username` text NOT NULL,
	`entry_id` integer NOT NULL,
	`truck_unit` text,
	`truck_label` text,
	`kind` text DEFAULT 'service' NOT NULL,
	`category` text NOT NULL,
	`performed_at` integer NOT NULL,
	`odometer` real,
	`description` text NOT NULL,
	`shop` text,
	`cost` real DEFAULT 0 NOT NULL,
	`parts_json` text DEFAULT '[]' NOT NULL,
	`oil_brand` text,
	`oil_weight` text,
	`next_due_miles` real,
	`next_due_at` integer,
	`published_at` integer NOT NULL
);
