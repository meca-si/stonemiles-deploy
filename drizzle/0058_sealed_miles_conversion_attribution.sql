ALTER TABLE `points_conversions` ADD COLUMN `miles_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `points_conversions` ADD COLUMN `task_paid_at` integer;
--> statement-breakpoint
ALTER TABLE `points_conversions` ADD COLUMN `miles_paid_at` integer;
