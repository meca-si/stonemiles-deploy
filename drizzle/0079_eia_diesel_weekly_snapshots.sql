CREATE TABLE `eia_diesel_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_of` text NOT NULL,
	`national` real NOT NULL,
	`gulf_coast` real NOT NULL,
	`west_coast` real NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eia_diesel_snapshots_week_of_unique` ON `eia_diesel_snapshots` (`week_of`);
