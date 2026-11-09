ALTER TABLE `market_pulse_weeks` ADD COLUMN `flatbed_rate_per_mile` real;
--> statement-breakpoint
ALTER TABLE `market_pulse_weeks` ADD COLUMN `dryvan_rate_per_mile` real;
--> statement-breakpoint
ALTER TABLE `market_pulse_weeks` ADD COLUMN `reefer_rate_per_mile` real;
--> statement-breakpoint
UPDATE `market_pulse_weeks` SET `flatbed_rate_per_mile` = 3.31, `dryvan_rate_per_mile` = 2.85, `reefer_rate_per_mile` = 3.45 WHERE `week_ending` = '2026-10-30' AND `flatbed_rate_per_mile` IS NULL AND `dryvan_rate_per_mile` IS NULL AND `reefer_rate_per_mile` IS NULL;
