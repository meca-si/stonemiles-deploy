ALTER TABLE `profile` ADD COLUMN `company_name` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `driver_cpm` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `extra_charges` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `extra_charges_note` text;
--> statement-breakpoint
ALTER TABLE `trip_queue` ADD COLUMN `extra_charges` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trip_queue` ADD COLUMN `extra_charges_note` text;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `extra_charges` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `extra_charges_note` text;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `pay_rate` real;
