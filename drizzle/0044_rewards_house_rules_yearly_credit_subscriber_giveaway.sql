ALTER TABLE `admin_settings` RENAME COLUMN `signup_credit_stoner` TO `yearly_credit_stoner`;
--> statement-breakpoint
UPDATE `welcome_credits` SET `kind` = 'yearly' WHERE `kind` = 'signup';
--> statement-breakpoint
CREATE TABLE `subscription_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `plan` text NOT NULL,
  `period` text NOT NULL DEFAULT 'monthly',
  `kind` text NOT NULL DEFAULT 'new',
  `payment_ref` text NOT NULL,
  `points_awarded` integer NOT NULL DEFAULT 0,
  `discounted` integer NOT NULL DEFAULT 0,
  `counted_for_giveaway` integer NOT NULL DEFAULT 0,
  `reversed` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_events_payment_ref_unique` ON `subscription_events` (`payment_ref`);
--> statement-breakpoint
CREATE TABLE `giveaway_cycles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `gold_count` integer NOT NULL DEFAULT 0,
  `diamond_count` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'filling',
  `created_at` integer NOT NULL,
  `drawn_at` integer
);
--> statement-breakpoint
CREATE TABLE `giveaway_cycle_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `cycle_id` integer NOT NULL,
  `username` text NOT NULL,
  `tier` text NOT NULL,
  `created_at` integer NOT NULL
);
