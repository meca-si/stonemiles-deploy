ALTER TABLE `pay_entries` ADD COLUMN `username` text;
--> statement-breakpoint
UPDATE `pay_entries` SET `username` = (SELECT `social_username` FROM `profile` WHERE `profile`.`id` = 1) WHERE `username` IS NULL;
