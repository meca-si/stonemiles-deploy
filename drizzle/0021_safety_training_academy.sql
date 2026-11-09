CREATE TABLE `training_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`course_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`score_pct` integer NOT NULL,
	`correct_count` integer NOT NULL,
	`total_questions` integer NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`course_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`score_pct` integer NOT NULL,
	`chain_hash` text,
	`completed_at` integer NOT NULL
);
