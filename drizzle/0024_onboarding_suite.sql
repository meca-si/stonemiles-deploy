CREATE TABLE `onboarding_state` (
	`username` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'driver' NOT NULL,
	`dismissed` integer DEFAULT 0 NOT NULL,
	`owner_intro_seen` integer DEFAULT 0 NOT NULL,
	`steps_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `onboarding_help_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`topic` text NOT NULL,
	`flag` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fleet_trucks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`unit_label` text NOT NULL,
	`detail` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
