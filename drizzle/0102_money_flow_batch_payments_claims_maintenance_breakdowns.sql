ALTER TABLE `loads` ADD COLUMN `deadhead_miles` real;
--> statement-breakpoint
CREATE TABLE `load_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`amount` real NOT NULL,
	`paid_at` integer NOT NULL,
	`note` text,
	`chain_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claim_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer,
	`kind` text NOT NULL,
	`amount` real NOT NULL,
	`note` text,
	`occurred_at` integer NOT NULL,
	`chain_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item` text NOT NULL,
	`interval_miles` real NOT NULL,
	`last_done_odometer` real,
	`last_done_at` integer,
	`note` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_services_item_unique` ON `maintenance_services` (`item`);
--> statement-breakpoint
CREATE TABLE `breakdown_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`location_note` text,
	`note` text,
	`costs_json` text DEFAULT '[]' NOT NULL,
	`chain_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
