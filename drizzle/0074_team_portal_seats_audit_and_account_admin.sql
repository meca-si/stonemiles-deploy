CREATE TABLE `team_seats` (
	`username` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL DEFAULT 'support',
	`active` integer NOT NULL DEFAULT 1,
	`granted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_username` text NOT NULL,
	`action` text NOT NULL,
	`target_username` text,
	`detail` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_admin` (
	`username` text PRIMARY KEY NOT NULL,
	`tier` text,
	`trucks` integer,
	`dispatch_seats` integer,
	`beta_access` integer,
	`status` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
