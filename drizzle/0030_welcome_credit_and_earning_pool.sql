ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_stoner` real NOT NULL DEFAULT 100;
--> statement-breakpoint
CREATE TABLE `welcome_credits` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `status` text NOT NULL DEFAULT 'queued',
  `created_at` integer NOT NULL,
  `paid_at` integer
);
--> statement-breakpoint
CREATE TABLE `earning_pool_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `username` text,
  `note` text,
  `created_at` integer NOT NULL
);
