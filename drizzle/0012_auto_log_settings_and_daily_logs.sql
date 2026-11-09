ALTER TABLE `company_setup` ADD COLUMN `auto_log_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `company_setup` ADD COLUMN `auto_log_notify` text DEFAULT 'immediate' NOT NULL;
--> statement-breakpoint
ALTER TABLE `company_members` ADD COLUMN `auto_log_override` text;
--> statement-breakpoint
CREATE TABLE `daily_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer,
  `username` text NOT NULL,
  `log_date` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `opened_at` integer NOT NULL,
  `closed_at` integer,
  `start_miles` real,
  `start_miles_source` text,
  `fuel_start` text,
  `hos_start` text,
  `pretrip` text,
  `finish_miles` real,
  `total_miles` real,
  `fuel_usage` text,
  `hos_end` text,
  `loads_delivered` integer DEFAULT 0 NOT NULL,
  `detention_text` text,
  `critical_defect` integer DEFAULT 0 NOT NULL
);
