CREATE TABLE `pay_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`is_form` integer DEFAULT false NOT NULL,
	`payer` text NOT NULL,
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
	`created_at` integer NOT NULL
);
