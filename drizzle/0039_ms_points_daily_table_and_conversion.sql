CREATE TABLE `points_conversions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `points` integer NOT NULL,
  `stoner_amount` real NOT NULL,
  `status` text NOT NULL DEFAULT 'queued',
  `created_at` integer NOT NULL,
  `paid_at` integer
);
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `points_conversion_live` integer NOT NULL DEFAULT 0;
