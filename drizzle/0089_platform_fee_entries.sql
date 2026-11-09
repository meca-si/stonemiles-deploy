CREATE TABLE `platform_fee_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`board_load_id` integer,
	`company_id` integer NOT NULL,
	`carrier_username` text NOT NULL,
	`gross_amount` real NOT NULL,
	`fee_amount` real NOT NULL,
	`delivered_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_fee_entries_load_id_unique` ON `platform_fee_entries` (`load_id`);
