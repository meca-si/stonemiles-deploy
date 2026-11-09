CREATE TABLE `fuel_price_reports_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `station` text NOT NULL,
  `lat` real,
  `lon` real,
  `state` text,
  `price` real NOT NULL,
  `reported_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `grade` text DEFAULT 'reported' NOT NULL
);
--> statement-breakpoint
INSERT INTO `fuel_price_reports_new` (`id`, `station`, `lat`, `lon`, `state`, `price`, `reported_at`, `created_at`, `grade`)
SELECT `id`, `station`, `lat`, `lon`, `state`, `price`, `reported_at`, `created_at`, 'reported' FROM `fuel_price_reports`;
--> statement-breakpoint
DROP TABLE `fuel_price_reports`;
--> statement-breakpoint
ALTER TABLE `fuel_price_reports_new` RENAME TO `fuel_price_reports`;
