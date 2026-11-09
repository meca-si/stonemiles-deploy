-- Instant Pay Phase 0 (records only — no money movement): the Payment
-- Packet + invoice fingerprint registry, and durable broker-identity
-- capture on the rows a load passes through (broker link → submission
-- → board post → driver load). Existing rows keep NULL broker fields —
-- nothing is backfilled.
CREATE TABLE `payment_packets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`packet_ref` text NOT NULL,
	`fingerprint` text NOT NULL,
	`invoice_ref` text NOT NULL,
	`invoice_fingerprint` text NOT NULL,
	`invoice_amount` real,
	`broker_name` text,
	`broker_company` text,
	`broker_mc` text,
	`broker_source` text,
	`broker_link_id` integer,
	`rate_con_sha256` text,
	`bol_sha256` text,
	`pod_seal_hash` text,
	`invoice_seen_before` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_packets_load_id_unique` ON `payment_packets` (`load_id`);
--> statement-breakpoint
CREATE TABLE `invoice_registry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`packet_id` integer NOT NULL,
	`load_id` integer NOT NULL,
	`packet_ref` text NOT NULL,
	`registered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_registry_fingerprint_unique` ON `invoice_registry` (`fingerprint`);
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `broker_name` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `broker_company` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `broker_mc` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `broker_source` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `broker_link_id` integer;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_name` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_company` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_mc` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_source` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_link_id` integer;
--> statement-breakpoint
ALTER TABLE `broker_links` ADD COLUMN `broker_mc` text;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `broker_mc` text;
