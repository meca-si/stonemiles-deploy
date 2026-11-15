-- Points earning lanes (locked by x, 2026-11-15 — the three lanes in
-- pointsLanes.ts ride the existing points_log ledger; this migration
-- adds only the two bookkeeping tables the lanes need plus the
-- reporter stamp for Lane 2 fuel reports).
-- (1) poster_referrals: a driver's broker/shipper referral, recorded
-- when the desk creates the poster account carrying the driver's
-- referral code. pending until the poster's first load is released
-- to a board, then landed — the Lane 3 award pays at landing, never
-- at signup.
-- (2) sealed_lanes: the first-sealed-lane registry — one row per
-- normalized origin->destination lane key, claimed by the first
-- driver to seal a load on it (first writer wins on the PK).
-- (3) fuel_price_reports.reporter: stamped ONLY by reportFuelPrice
-- (manual reports) so a corroborated report can pay its reporter.
-- Purchase-derived price rows stay anonymous (reporter NULL) by
-- design and never earn Lane 2 points.
CREATE TABLE `poster_referrals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_username` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`landed_at` integer
);
--> statement-breakpoint
CREATE TABLE `sealed_lanes` (
	`lane_key` text PRIMARY KEY NOT NULL,
	`first_username` text NOT NULL,
	`first_load_id` integer NOT NULL,
	`first_sealed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fuel_price_reports` ADD COLUMN `reporter` text;
