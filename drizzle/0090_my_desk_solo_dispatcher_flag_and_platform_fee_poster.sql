ALTER TABLE `social_users` ADD `dispatcher_poster` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `platform_fee_entries_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`board_load_id` integer,
	`company_id` integer,
	`poster_username` text,
	`carrier_username` text NOT NULL,
	`gross_amount` real NOT NULL,
	`fee_amount` real NOT NULL,
	`delivered_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `platform_fee_entries_new` (`id`, `load_id`, `board_load_id`, `company_id`, `poster_username`, `carrier_username`, `gross_amount`, `fee_amount`, `delivered_at`, `created_at`, `updated_at`)
SELECT e.`id`, e.`load_id`, e.`board_load_id`, e.`company_id`,
	(SELECT bpl.`created_by` FROM `board_loads` bl JOIN `broker_poster_loads` bpl ON bpl.`id` = bl.`broker_poster_load_id` WHERE bl.`id` = e.`board_load_id`),
	e.`carrier_username`, e.`gross_amount`, e.`fee_amount`, e.`delivered_at`, e.`created_at`, e.`updated_at`
FROM `platform_fee_entries` e;
--> statement-breakpoint
DROP TABLE `platform_fee_entries`;
--> statement-breakpoint
ALTER TABLE `platform_fee_entries_new` RENAME TO `platform_fee_entries`;
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_fee_entries_load_id_unique` ON `platform_fee_entries` (`load_id`);
