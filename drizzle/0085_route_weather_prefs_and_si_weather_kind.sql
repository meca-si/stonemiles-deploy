ALTER TABLE `app_settings` ADD COLUMN `map_show_radar` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `weather_gust_threshold_mph` integer DEFAULT 35 NOT NULL;
