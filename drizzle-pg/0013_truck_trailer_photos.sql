-- Truck + trailer photos and My Trailer identity. PG twin of
-- drizzle/0120_truck_trailer_photos.sql — see that file's header.
-- Four trailer-identity columns on profile (year, make, VIN, plate;
-- type/length already live there as routing specs) and the
-- vehicle_photos table (kind = truck | trailer, up to 5 per set,
-- cap enforced server-side; file bytes in the avatar's blob store).
ALTER TABLE "profile" ADD COLUMN "trailer_year" integer;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "trailer_make" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "trailer_vin" text;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "trailer_plate" text;
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"blob_key" text,
	"mime" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
