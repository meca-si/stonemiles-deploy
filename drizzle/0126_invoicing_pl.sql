-- Invoicing + P&L (TMS completion queue item 3, 2026-11-15;
-- gap-tools-spec item 1).
-- (1) profile gains the driver's BUSINESS identity (biz_*): the
-- name, address, phone, email, payment instructions, and logo that
-- brand their invoices and P&L statements (Settings → Business
-- profile). All nullable — a driver who never sets them invoices
-- under their profile name with no logo. The logo is a blob (key +
-- mime on the row), the avatar pattern.
-- (2) load_invoices: one branded invoice per sealed load. The row
-- snapshots the bill at creation (bill-to, lane, reference, lines,
-- amount) so editing the load later never rewrites a bill already
-- cut. Lifecycle draft → issued → paid; "overdue" is derived from
-- due_at at read time, never stored. load_id is UNIQUE — one live
-- invoice per load; deleting a draft frees the load. The rate lives
-- only in lines_json/amount on this table: the invoice is the one
-- document the rate prints on (standing rate law).
ALTER TABLE `profile` ADD COLUMN `biz_name` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_address` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_phone` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_email` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_payment_instructions` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_logo_blob_key` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `biz_logo_mime` text;
--> statement-breakpoint
CREATE TABLE `load_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer,
	`load_id` integer NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`bill_to_name` text NOT NULL,
	`bill_to_company` text,
	`shipper` text,
	`pickup_city` text,
	`pickup_state` text,
	`delivery_city` text,
	`delivery_state` text,
	`reference_number` text,
	`commodity` text,
	`delivered_at` integer NOT NULL,
	`lines_json` text DEFAULT '[]' NOT NULL,
	`amount` real NOT NULL,
	`due_days` integer DEFAULT 30 NOT NULL,
	`issued_at` integer,
	`due_at` integer,
	`paid_at` integer,
	`notes` text,
	`chain_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `load_invoices_load_id_unique` UNIQUE(`load_id`)
);
