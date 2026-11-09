ALTER TABLE `profile` ADD COLUMN `plan` text DEFAULT 'full' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `owner_price` real;
--> statement-breakpoint
ALTER TABLE `chat_groups` ADD COLUMN `company_id` integer;
--> statement-breakpoint
ALTER TABLE `chat_groups` ADD COLUMN `pin_message_id` integer;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD COLUMN `deleted` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `companies` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `owner_username` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_members` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL,
  `username` text NOT NULL,
  `role` text DEFAULT 'driver' NOT NULL,
  `joined_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `driver_codes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL,
  `code` text NOT NULL,
  `single_use` integer DEFAULT 1 NOT NULL,
  `used_by` text,
  `revoked` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
