ALTER TABLE `pay_entries` ADD COLUMN `per_diem` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `pay_stub_deliveries` ADD COLUMN `per_diem` real DEFAULT 0 NOT NULL;
