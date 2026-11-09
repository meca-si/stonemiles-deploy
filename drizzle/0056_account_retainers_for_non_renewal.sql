CREATE TABLE `account_retainers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`plan` text NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'active',
	`lifted_at` integer,
	`expired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
