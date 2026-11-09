ALTER TABLE `loads` ADD COLUMN `pickup_load_blob_key` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_mime` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_sha256` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_captured_at` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_lat` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_lon` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_load_source` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_blob_key` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_mime` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_sha256` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_captured_at` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_lat` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_lon` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_bol_source` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_sealed_at` integer;
