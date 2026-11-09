CREATE TABLE `owner_giveaways` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`owner_username` text NOT NULL,
	`currency` text NOT NULL,
	`pot_amount` real NOT NULL,
	`mode` text NOT NULL,
	`winner_count` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`commitment_hash` text,
	`seed_method` text,
	`draw_seed` text,
	`draw_head_hash` text,
	`distribution_note` text,
	`created_at` integer NOT NULL,
	`funded_at` integer,
	`distributed_at` integer
);
--> statement-breakpoint
CREATE TABLE `owner_giveaway_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`giveaway_id` integer NOT NULL,
	`username` text NOT NULL,
	`payout_address` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`is_winner` integer DEFAULT false NOT NULL,
	`tx_hash` text,
	`verification` text,
	`verified_amount` real,
	`recorded_at` integer
);
