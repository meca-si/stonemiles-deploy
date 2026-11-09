CREATE TABLE `doc_copy_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`driver_email` text,
	`dispatch_email` text,
	`owner_email` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `filed_doc_copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`doc_kind` text NOT NULL,
	`label` text NOT NULL,
	`blob_key` text,
	`owns_blob` integer DEFAULT 0 NOT NULL,
	`mime` text,
	`sha256` text NOT NULL,
	`source` text NOT NULL,
	`filed_by` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filed_doc_copies_dedupe_key_unique` ON `filed_doc_copies` (`dedupe_key`);
--> statement-breakpoint
CREATE TABLE `doc_email_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`filed_copy_id` integer,
	`doc_kind` text NOT NULL,
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
CREATE UNIQUE INDEX `doc_email_deliveries_dedupe_key_unique` ON `doc_email_deliveries` (`dedupe_key`);
