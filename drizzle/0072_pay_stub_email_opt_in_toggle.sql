ALTER TABLE `doc_copy_settings` ADD COLUMN `pay_stub_email_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `pay_stub_email_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pay_entry_id` integer,
	`delivery_id` integer,
	`kind` text NOT NULL,
	`is_form` integer DEFAULT 0 NOT NULL,
	`payer` text NOT NULL,
	`recipient_role` text NOT NULL,
	`recipient_email` text,
	`recipient_username` text,
	`status` text NOT NULL,
	`detail` text,
	`provider_id` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_stub_email_deliveries_dedupe_key_unique` ON `pay_stub_email_deliveries` (`dedupe_key`);
