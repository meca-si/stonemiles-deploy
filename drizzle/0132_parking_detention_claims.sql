-- Reservable HOS-aware parking + detention collection pack
-- (Research Wave 2 items 4 + 5, 2026-11-15).
-- parking_reservations: a planner-picked parking stop reserved
-- through a PARTNER's supply — a row exists only when a partner
-- actually accepted the hold (the parking.ts seam returns null
-- until a partner agreement + credentials exist; no partner, no
-- rows, no fake confirmations). The arrival window (eta /
-- latest_arrival) is computed against the driver's HOS clock at
-- reserve time and snapshotted here.
-- loads gains the driver's OWN detention terms (a per-hour figure
-- they recorded from their agreement) — the detention claim pack
-- prices its time from it and labels it "driver's recorded
-- terms"; null = no terms on file, the pack prints time only.
-- detention_records gains the claim lifecycle cache (status +
-- generated/sent stamps + recipient); every transition seals into
-- the chain. The table itself stays money-free by design.
CREATE TABLE `parking_reservations` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`driver_username` text NOT NULL,
	`stop_name` text NOT NULL,
	`stop_lat` real NOT NULL,
	`stop_lon` real NOT NULL,
	`along_mi` real NOT NULL,
	`eta_at` integer NOT NULL,
	`latest_arrival_at` integer NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`partner_name` text,
	`partner_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `detention_rate_per_hour` real;
--> statement-breakpoint
ALTER TABLE `detention_records` ADD COLUMN `claim_status` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `detention_records` ADD COLUMN `claim_generated_at` integer;
--> statement-breakpoint
ALTER TABLE `detention_records` ADD COLUMN `claim_sent_at` integer;
--> statement-breakpoint
ALTER TABLE `detention_records` ADD COLUMN `claim_recipient` text;
