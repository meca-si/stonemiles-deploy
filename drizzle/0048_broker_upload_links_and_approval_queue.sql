CREATE TABLE `broker_optins` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`company_id` integer,
	`owner_username` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_key` text NOT NULL,
	`company_id` integer,
	`owner_username` text NOT NULL,
	`broker_name` text NOT NULL,
	`broker_company` text,
	`broker_contact` text,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broker_links_token_unique` ON `broker_links` (`token`);
--> statement-breakpoint
CREATE TABLE `broker_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_id` integer NOT NULL,
	`scope_key` text NOT NULL,
	`company_id` integer,
	`owner_username` text NOT NULL,
	`broker_name` text NOT NULL,
	`broker_company` text,
	`shipper` text,
	`pickup_city` text,
	`pickup_state` text,
	`delivery_city` text,
	`delivery_state` text,
	`pickup_text` text,
	`delivery_text` text,
	`rate` real,
	`extra_charges` real DEFAULT 0 NOT NULL,
	`extra_charges_note` text,
	`weight_lbs` integer,
	`commodity` text,
	`hazmat` integer DEFAULT 0 NOT NULL,
	`equipment_type` text,
	`notes` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`doc_sha256` text,
	`doc_blob_key` text,
	`doc_mime` text,
	`board_load_id` integer,
	`load_id` integer,
	`trip_queue_id` integer,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
