ALTER TABLE `companies` ADD `dispatcher_fee_pct` real;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD `dispatcher_fee_pct` real;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD `dispatcher_fee_pct` real;
