ALTER TABLE `profile` ADD COLUMN `kyc_status` text NOT NULL DEFAULT 'not_started';
--> statement-breakpoint
CREATE TABLE `cashout_holds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `reason` text NOT NULL,
  `available_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
