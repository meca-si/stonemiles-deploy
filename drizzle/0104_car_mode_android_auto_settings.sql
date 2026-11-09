ALTER TABLE `app_settings` ADD COLUMN `car_mode_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `car_mode_auto_launch` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `car_voice_prompts` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `car_show_hos` integer DEFAULT true NOT NULL;
