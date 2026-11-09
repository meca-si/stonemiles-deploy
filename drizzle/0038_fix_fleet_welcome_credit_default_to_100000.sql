CREATE TABLE `admin_settings_new` (
  `id` integer PRIMARY KEY NOT NULL,
  `referral_reward_stoner` real NOT NULL DEFAULT 100,
  `welcome_credit_stoner` real NOT NULL DEFAULT 100,
  `welcome_credit_gold_stoner` real NOT NULL DEFAULT 1000,
  `welcome_credit_diamond_stoner` real NOT NULL DEFAULT 10000,
  `welcome_credit_owner_stoner` real NOT NULL DEFAULT 100000,
  `signup_credit_stoner` real NOT NULL DEFAULT 100,
  `giveaway_weekly_cap` integer NOT NULL DEFAULT 10,
  `giveaway_vest_pct` real NOT NULL DEFAULT 25
);
--> statement-breakpoint
INSERT INTO `admin_settings_new` (`id`, `referral_reward_stoner`, `welcome_credit_stoner`, `welcome_credit_gold_stoner`, `welcome_credit_diamond_stoner`, `welcome_credit_owner_stoner`, `signup_credit_stoner`, `giveaway_weekly_cap`, `giveaway_vest_pct`)
SELECT `id`, `referral_reward_stoner`, `welcome_credit_stoner`, `welcome_credit_gold_stoner`, `welcome_credit_diamond_stoner`, CASE WHEN `welcome_credit_owner_stoner` = 25000 THEN 100000 ELSE `welcome_credit_owner_stoner` END, `signup_credit_stoner`, `giveaway_weekly_cap`, `giveaway_vest_pct` FROM `admin_settings`;
--> statement-breakpoint
DROP TABLE `admin_settings`;
--> statement-breakpoint
ALTER TABLE `admin_settings_new` RENAME TO `admin_settings`;
