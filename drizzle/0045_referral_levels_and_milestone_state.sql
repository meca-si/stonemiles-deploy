CREATE TABLE `referral_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_username` text NOT NULL,
	`level_key` text NOT NULL,
	`threshold` integer NOT NULL,
	`bonus_points` integer NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`reversed` integer DEFAULT false NOT NULL,
	`reversed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_milestones_referrer_level_idx` ON `referral_milestones` (`referrer_username`,`level_key`);
