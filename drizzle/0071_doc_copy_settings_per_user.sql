ALTER TABLE `doc_copy_settings` ADD COLUMN `username` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `doc_copy_settings` SET `username` = COALESCE((SELECT `social_username` FROM `profile` WHERE `profile`.`id` = 1), 'driver') WHERE `username` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_copy_settings_username_unique` ON `doc_copy_settings` (`username`);
