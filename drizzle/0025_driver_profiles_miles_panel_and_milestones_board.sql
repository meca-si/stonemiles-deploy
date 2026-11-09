ALTER TABLE `social_users` ADD COLUMN `show_miles_panel` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `board_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`area` text NOT NULL,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`location_source` text DEFAULT 'driver_entered' NOT NULL,
	`miles_reached` real,
	`detail_text` text,
	`edited` integer DEFAULT 0 NOT NULL,
	`chain_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `board_likes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`username` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_likes_post_user` ON `board_likes` (`post_id`, `username`);
