-- Assign-to-driver flow (x, 2026-11-10): a board assignment becomes a
-- pending OFFER (board_loads.status "assigned", naming the driver in
-- claimed_by) that creates NO driver load until the driver accepts.
-- A decline returns the row to "open" and leaves its reason on the row
-- for the desk. Booked loads also gain the reference number (BOL / PO
-- / order #) and pickup / delivery appointment instants the desk
-- booked with; the reference (and the delivery appointment, as the
-- load's dock appointment) carries onto the driver's load at accept,
-- so loads gains the reference column too. All columns are nullable —
-- every pre-0109 row simply has none of this yet.
ALTER TABLE `board_loads` ADD COLUMN `reference_number` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `pickup_appt_at` integer;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `delivery_appt_at` integer;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `decline_reason` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `declined_by` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `declined_at` integer;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `reference_number` text;
