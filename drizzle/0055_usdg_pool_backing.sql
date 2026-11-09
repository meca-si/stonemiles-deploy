CREATE TABLE `earning_pool_backing_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `amount_usdg` real NOT NULL,
  `username` text,
  `ref_key` text,
  `note` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `earning_pool_backing_ledger_ref_key_unique` ON `earning_pool_backing_ledger` (`ref_key`);
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `payout_manual_batch` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `usdg_backing_live` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `usdg_price_usd` real;
