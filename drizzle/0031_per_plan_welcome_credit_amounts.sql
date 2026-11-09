ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_gold_stoner` real NOT NULL DEFAULT 1000;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_diamond_stoner` real NOT NULL DEFAULT 10000;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_owner_stoner` real NOT NULL DEFAULT 25000;
