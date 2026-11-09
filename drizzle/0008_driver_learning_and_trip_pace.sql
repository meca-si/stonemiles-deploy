ALTER TABLE `trips` ADD COLUMN `avg_speed_mph` real;
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `over_limit_min` real;
--> statement-breakpoint
CREATE TABLE `learned_exclusions` (
  `pattern_key` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_state` (
  `id` integer PRIMARY KEY NOT NULL,
  `paused` integer DEFAULT 0 NOT NULL,
  `reset_at` integer
);
