ALTER TABLE `app_settings` ADD COLUMN `map_enhanced_view` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_tilt_mode` text DEFAULT 'auto' NOT NULL;
