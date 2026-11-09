ALTER TABLE `loads` ADD COLUMN `loaded_miles` real;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `miles_source` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `loaded_miles` real;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `miles_source` text;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `loaded_miles` real;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `miles_source` text;
