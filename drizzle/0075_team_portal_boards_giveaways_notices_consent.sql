CREATE TABLE `team_board_flags` (
	`board_load_id` integer PRIMARY KEY NOT NULL,
	`flagged_by` text NOT NULL,
	`note` text NOT NULL DEFAULT '',
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_giveaways` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_by` text NOT NULL,
	`currency` text NOT NULL,
	`pot_amount` real NOT NULL,
	`mode` text NOT NULL,
	`winner_count` integer,
	`status` text NOT NULL DEFAULT 'draft',
	`commitment_hash` text,
	`seed_method` text,
	`draw_seed` text,
	`draw_head_hash` text,
	`funding_source` text,
	`distribution_note` text,
	`created_at` integer NOT NULL,
	`funded_at` integer,
	`distributed_at` integer
);
--> statement-breakpoint
CREATE TABLE `team_giveaway_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`giveaway_id` integer NOT NULL,
	`username` text NOT NULL,
	`payout_address` text NOT NULL,
	`amount` real NOT NULL DEFAULT 0,
	`is_winner` integer NOT NULL DEFAULT 0,
	`paid_at` integer
);
--> statement-breakpoint
CREATE TABLE `team_change_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`actor_username` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text NOT NULL DEFAULT '',
	`email_status` text NOT NULL DEFAULT 'queued',
	`email_detail` text NOT NULL DEFAULT '',
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_consent_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_username` text NOT NULL,
	`requested_by` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL DEFAULT '',
	`fields_json` text,
	`status` text NOT NULL DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`applied_at` integer
);
