ALTER TABLE `profile` ADD COLUMN `pay_basis` text NOT NULL DEFAULT 'cpm';
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `driver_pay_pct` real;
--> statement-breakpoint
ALTER TABLE `trip_queue` ADD COLUMN `pay_basis` text NOT NULL DEFAULT 'cpm';
--> statement-breakpoint
ALTER TABLE `trip_queue` ADD COLUMN `pay_percent` real;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `pay_basis` text NOT NULL DEFAULT 'cpm';
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `pay_percent` real;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `load_gross` real;
