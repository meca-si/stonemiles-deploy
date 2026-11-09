ALTER TABLE `points_conversions` ADD COLUMN `anchor_usd` real;
--> statement-breakpoint
ALTER TABLE `points_conversions` ADD COLUMN `price_usd` real;
--> statement-breakpoint
ALTER TABLE `welcome_credits` ADD COLUMN `amount_usd` real;
--> statement-breakpoint
ALTER TABLE `welcome_vesting` ADD COLUMN `amount_usd` real;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_gold_usd` real DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_diamond_usd` real DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `welcome_credit_owner_usd` real DEFAULT 25 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_settings` ADD COLUMN `yearly_credit_usd` real DEFAULT 1 NOT NULL;
