ALTER TABLE `admin_settings` ADD COLUMN `team_email` text DEFAULT 'stonervisionteam@gmail.com' NOT NULL;
--> statement-breakpoint
ALTER TABLE `team_change_notices` ADD COLUMN `team_email` text DEFAULT 'stonervisionteam@gmail.com' NOT NULL;
