ALTER TABLE `companies` ADD `kind` text DEFAULT 'fleet' NOT NULL;
--> statement-breakpoint
CREATE TABLE `client_fleets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`mc_number` text,
	`usdot_number` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `company_members` ADD `client_fleet_id` integer;
--> statement-breakpoint
ALTER TABLE `driver_codes` ADD `client_fleet_id` integer;
