ALTER TABLE `welcome_credits` ADD COLUMN `kind` text NOT NULL DEFAULT 'welcome';
--> statement-breakpoint
ALTER TABLE `welcome_credits` ADD COLUMN `locked` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `welcome_credits` ADD COLUMN `plan` text;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `signup_credit_stoner` real NOT NULL DEFAULT 100;
--> statement-breakpoint
UPDATE `admin_settings` SET `welcome_credit_owner_stoner` = 100000 WHERE `id` = 1 AND `welcome_credit_owner_stoner` = 25000;
