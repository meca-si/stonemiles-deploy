CREATE TABLE `giveaway_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `week_key` text NOT NULL,
  `kind` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `giveaway_locks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `week_key` text NOT NULL UNIQUE,
  `prizes_json` text NOT NULL,
  `wallet_balance` real NOT NULL,
  `locked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `giveaway_draws` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `week_key` text NOT NULL,
  `prizes_json` text NOT NULL,
  `winners_json` text NOT NULL,
  `drawn_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `giveaway_vesting` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `draw_id` integer NOT NULL,
  `tranche_no` integer NOT NULL,
  `total_tranches` integer NOT NULL,
  `amount_stoner` real NOT NULL,
  `due_at` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `paid_at` integer
);
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `giveaway_weekly_cap` integer NOT NULL DEFAULT 10;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `giveaway_vest_pct` real NOT NULL DEFAULT 25;
