-- Reservable HOS-aware parking + detention collection pack.
-- PG twin of drizzle/0132_parking_detention_claims.sql — see that
-- file's header. parking_reservations (partner-held parking
-- reservations with the HOS arrival window snapshot), the load's
-- driver-recorded detention terms, and the detention claim
-- lifecycle cache on detention_records.
CREATE TABLE "parking_reservations" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"driver_username" text NOT NULL,
	"stop_name" text NOT NULL,
	"stop_lat" double precision NOT NULL,
	"stop_lon" double precision NOT NULL,
	"along_mi" double precision NOT NULL,
	"eta_at" timestamp with time zone NOT NULL,
	"latest_arrival_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"partner_name" text,
	"partner_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
ALTER TABLE "loads" ADD COLUMN "detention_rate_per_hour" double precision;
ALTER TABLE "detention_records" ADD COLUMN "claim_status" text DEFAULT 'none' NOT NULL;
ALTER TABLE "detention_records" ADD COLUMN "claim_generated_at" timestamp with time zone;
ALTER TABLE "detention_records" ADD COLUMN "claim_sent_at" timestamp with time zone;
ALTER TABLE "detention_records" ADD COLUMN "claim_recipient" text;
