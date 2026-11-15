-- Rewards Layer 2 + anti-cheat safety net (locked by x, 2026-11-15 —
-- pointsLayer2.ts rides the same points_log ledger as Lanes 1–3; this
-- migration adds only the birthday fields and the safety-hold table).
-- (1) profile.birth_month / birth_day: the driver's birthday as
-- MONTH + DAY only. There is deliberately NO birth-year column — a
-- year is never collected, so it is structurally impossible to
-- store. Both nullable (optional; the pair validates together in
-- saveProfile).
-- (2) points_safety_holds: suspected-farming holds from the safety
-- net. One open row per (username, kind); while a maintenance hold
-- is open, maintenance-discipline awards withhold and the pattern
-- sits on the owner's points safety list. Nothing auto-bans and
-- nothing auto-forfeits — clearing a hold is the owner's manual
-- action (proven multi-accounting forfeits stay manual too,
-- House Rule 3).
ALTER TABLE `profile` ADD COLUMN `birth_month` integer;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `birth_day` integer;
--> statement-breakpoint
CREATE TABLE `points_safety_holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
