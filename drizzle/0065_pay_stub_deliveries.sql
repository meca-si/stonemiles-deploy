CREATE TABLE `pay_stub_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`sender_username` text NOT NULL,
	`recipient_username` text NOT NULL,
	`kind` text NOT NULL,
	`delivery_type` text NOT NULL,
	`paid_at` integer NOT NULL,
	`tax_year` integer,
	`gross` real NOT NULL,
	`federal_withheld` real DEFAULT 0 NOT NULL,
	`state_withheld` real DEFAULT 0 NOT NULL,
	`other_deductions` real DEFAULT 0 NOT NULL,
	`notes` text,
	`stub_blob_key` text,
	`stub_mime` text,
	`stub_sha256` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`flag_reason` text,
	`pay_entry_id` integer,
	`sent_at` integer NOT NULL,
	`responded_at` integer
);
--> statement-breakpoint
ALTER TABLE `pay_entries` ADD COLUMN `source` text;
--> statement-breakpoint
ALTER TABLE `pay_entries` ADD COLUMN `delivery_id` integer;
