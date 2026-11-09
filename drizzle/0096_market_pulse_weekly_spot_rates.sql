CREATE TABLE `market_pulse_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_number` integer NOT NULL,
	`week_ending` text NOT NULL,
	`total_rate_per_mile` real NOT NULL,
	`total_change_cents` real NOT NULL,
	`total_yoy_pct` real NOT NULL,
	`total_loads_change_pct` real NOT NULL,
	`mdi_note` text,
	`flatbed_change_cents` real NOT NULL,
	`flatbed_yoy_pct` real NOT NULL,
	`flatbed_loads_change_pct` real NOT NULL,
	`dryvan_change_cents` real NOT NULL,
	`dryvan_yoy_pct` real NOT NULL,
	`dryvan_loads_change_pct` real NOT NULL,
	`reefer_change_cents` real NOT NULL,
	`reefer_yoy_pct` real NOT NULL,
	`reefer_loads_change_pct` real NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_pulse_weeks_week_ending_unique` ON `market_pulse_weeks` (`week_ending`);
