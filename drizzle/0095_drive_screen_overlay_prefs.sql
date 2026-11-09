ALTER TABLE `app_settings` ADD COLUMN `drive_show_weather` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `drive_show_big_prompts` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `drive_show_traffic_legend` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `drive_show_eta_pill` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `drive_glass_level` text DEFAULT 'med' NOT NULL;
