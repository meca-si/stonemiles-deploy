CREATE TABLE `beta_codes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL,
  `kind` text DEFAULT 'driver' NOT NULL,
  `single_use` integer DEFAULT 1 NOT NULL,
  `used_by` text,
  `used_at` integer,
  `revoked` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `beta_access` (
  `id` integer PRIMARY KEY NOT NULL,
  `unlocked` integer DEFAULT 0 NOT NULL,
  `account_kind` text,
  `code_used` text,
  `unlocked_at` integer
);
--> statement-breakpoint
CREATE TABLE `referral_codes` (
  `username` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `referral_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `referrer_username` text NOT NULL,
  `referred_username` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `referral_rewards` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `referrer_username` text NOT NULL,
  `referred_username` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `status` text DEFAULT 'queued' NOT NULL,
  `created_at` integer NOT NULL,
  `paid_at` integer
);
--> statement-breakpoint
CREATE TABLE `reward_wallet_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `username` text,
  `note` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `referral_reward_stoner` real DEFAULT 100 NOT NULL
);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-X-OWNER1', 'owner', 0, 0, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-AUPI-KNWY', 'driver', 1, 0, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-09V5-R58Q', 'driver', 1, 0, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-MAZR-E86U', 'driver', 1, 0, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-VSQ5-F1VO', 'driver', 1, 0, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO `beta_codes` (`code`, `kind`, `single_use`, `revoked`, `created_at`) VALUES ('MILE-XMHB-R3L9', 'driver', 1, 0, strftime('%s', 'now') * 1000);
