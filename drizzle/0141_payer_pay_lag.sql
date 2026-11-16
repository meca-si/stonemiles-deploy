-- Per-payer PAY LAG for the settlement check (owner's build,
-- 2026-11-15). One new table: payer_pay_lag — how many days after
-- a work period a payer settles it (0 = same week, 7 = a week in
-- the hole, up to 30), set once per carrier by the driver. It
-- drives every automatic settlement-check window for that payer;
-- the check never assumes arrears. Username-keyed like
-- pay_entries; one row per (driver, payer).
CREATE TABLE `payer_pay_lag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`payer_key` text NOT NULL,
	`payer` text NOT NULL,
	`lag_days` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payer_pay_lag_username_payer_key_unique` ON `payer_pay_lag` (`username`,`payer_key`);
--> statement-breakpoint
-- Per-entry settlement-check OVERRIDES (same build): the driver's
-- verify-and-edit layer for ONE Pay Book entry — a window override
-- (window_from_at/window_to_at, both null = automatic window) and
-- load hold-outs / pull-ins (JSON id arrays). Overrides steer only
-- the check; they never touch sealed loads or the entry's own
-- figures. One row per (driver, pay entry).
CREATE TABLE `pay_entry_check_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`pay_entry_id` integer NOT NULL,
	`window_from_at` integer,
	`window_to_at` integer,
	`excluded_load_ids` text,
	`included_load_ids` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_entry_check_overrides_username_entry_unique` ON `pay_entry_check_overrides` (`username`,`pay_entry_id`);
