CREATE TABLE `learning_state_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT 1 NOT NULL,
	`reset_at` integer
);
--> statement-breakpoint
INSERT INTO `learning_state_new` (`id`, `paused`, `reset_at`) SELECT `id`, `paused`, `reset_at` FROM `learning_state`;
--> statement-breakpoint
DROP TABLE `learning_state`;
--> statement-breakpoint
ALTER TABLE `learning_state_new` RENAME TO `learning_state`;
