CREATE TABLE `account_holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`retainer_id` integer,
	`branch` text NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'active',
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
