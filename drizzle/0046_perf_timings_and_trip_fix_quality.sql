ALTER TABLE `trips` ADD COLUMN `fix_quality` text;
--> statement-breakpoint
CREATE TABLE `perf_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `username` text NOT NULL,
  `kind` text NOT NULL,
  `duration_ms` integer,
  `ok` integer,
  `trip_queue_id` integer,
  `detail` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `perf_events_user_created_idx` ON `perf_events` (`username`, `created_at`);
