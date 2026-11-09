CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`detail` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pin_guard` (
	`id` integer PRIMARY KEY NOT NULL,
	`failed_attempts` integer NOT NULL DEFAULT 0,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL DEFAULT 'USD',
	`status` text NOT NULL DEFAULT 'requires_provider',
	`plan` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_ledger_idempotency_key_unique` ON `payment_ledger` (`idempotency_key`);
