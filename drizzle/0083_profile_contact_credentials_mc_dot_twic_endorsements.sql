ALTER TABLE `social_users` ADD COLUMN `contact_email` text;
--> statement-breakpoint
ALTER TABLE `social_users` ADD COLUMN `mc_number` text;
--> statement-breakpoint
ALTER TABLE `social_users` ADD COLUMN `dot_number` text;
--> statement-breakpoint
ALTER TABLE `social_users` ADD COLUMN `twic_has` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `social_users` ADD COLUMN `twic_expires` text;
--> statement-breakpoint
ALTER TABLE `social_users` ADD COLUMN `endorsements` text DEFAULT '' NOT NULL;
