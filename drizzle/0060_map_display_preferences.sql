ALTER TABLE `app_settings` ADD COLUMN `map_base_style` text DEFAULT 'streets' NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_fuel` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_parking` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_hazards` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_intel` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_route` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_speed` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD COLUMN `map_show_labels` integer DEFAULT 1 NOT NULL;
