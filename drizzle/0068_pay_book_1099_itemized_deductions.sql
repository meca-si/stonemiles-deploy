ALTER TABLE `pay_entries` ADD COLUMN `deduction_lines` text;
--> statement-breakpoint
ALTER TABLE `pay_stub_deliveries` ADD COLUMN `deduction_lines` text;
