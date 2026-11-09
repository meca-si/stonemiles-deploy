CREATE TABLE `points_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `amount` integer NOT NULL,
  `reason` text NOT NULL,
  `source` text NOT NULL,
  `ref_key` text,
  `created_at` integer NOT NULL
);
