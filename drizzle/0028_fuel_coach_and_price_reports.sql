ALTER TABLE `trips` ADD COLUMN `over65_min` real;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `over70_min` real;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `idle_min` real;
--> statement-breakpoint
CREATE TABLE `fuel_price_reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `station` text NOT NULL,
  `lat` real NOT NULL,
  `lon` real NOT NULL,
  `state` text,
  `price` real NOT NULL,
  `reported_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
