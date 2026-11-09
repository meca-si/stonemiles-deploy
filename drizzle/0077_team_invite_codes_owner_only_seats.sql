CREATE TABLE `team_invite_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL DEFAULT 'support',
	`issued_by` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_by` text,
	`redeemed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invite_codes_code_unique` ON `team_invite_codes` (`code`);
