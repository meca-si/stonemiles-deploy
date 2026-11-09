CREATE TABLE `eld_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`company_id` integer,
	`label` text NOT NULL,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`token_enc` text,
	`token_last4` text,
	`feeds_json` text DEFAULT '[]' NOT NULL,
	`last_error` text,
	`connected_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `eld_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`feed` text NOT NULL,
	`payload_json` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `miles_source` text DEFAULT 'GPS' NOT NULL;
