ALTER TABLE `payment_packets` ADD COLUMN `receivable_key` text;
--> statement-breakpoint
ALTER TABLE `payment_packets` ADD COLUMN `receivable_seen_before` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `receivable_registry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receivable_key` text NOT NULL,
	`packet_id` integer NOT NULL,
	`load_id` integer NOT NULL,
	`packet_ref` text NOT NULL,
	`registered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receivable_registry_receivable_key_unique` ON `receivable_registry` (`receivable_key`);
