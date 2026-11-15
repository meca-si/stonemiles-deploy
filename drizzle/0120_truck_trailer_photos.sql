-- Truck + trailer photos and My Trailer identity (x's scope, 2026-11-15:
-- the trailer is its own piece of equipment — "the most important piece").
-- (1) Four trailer-identity columns on the profile row — year, make,
-- VIN, plate — mirroring the My Truck identity columns (0118), typed
-- in by the driver in Settings -> Truck in a My Trailer block beside
-- My Truck. Trailer type and length are NOT duplicated: they already
-- live on this row as the routing specs (trailer_type / length_ft).
-- Trailer VIN and plate are owner-only exactly like the truck's —
-- the public trailer line is year + make + trailer type only.
-- (2) vehicle_photos: up to 5 photos of the truck and up to 5 of the
-- trailer, two sets capped separately (kind column), one row per
-- photo. File bytes live in the same blob store the profile avatar
-- uses (blob_key + mime on the row). The cap is enforced server-side
-- in addVehiclePhoto; display rides the existing show_truck toggle.
ALTER TABLE `profile` ADD COLUMN `trailer_year` integer;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `trailer_make` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `trailer_vin` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `trailer_plate` text;
--> statement-breakpoint
CREATE TABLE `vehicle_photos` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`blob_key` text,
	`mime` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
