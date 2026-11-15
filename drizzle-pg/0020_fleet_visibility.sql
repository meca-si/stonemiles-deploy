-- Fleet visibility + outward sharing. PG twin of
-- drizzle/0127_fleet_visibility.sql — see that file's header.
-- driver_fleet_status is the share-up pipe: the driver's app
-- publishes a snapshot of the load they are running (lane, status,
-- stops, route end, ETA — never a rate or any money column) for
-- their fleet's owner + dispatch seats. Outward track share links
-- ride receive_links as kind "track"; no change needed there.
CREATE TABLE "driver_fleet_status" (
	"username" text PRIMARY KEY NOT NULL,
	"load_id" integer,
	"load_status" text,
	"pickup_city" text,
	"pickup_state" text,
	"delivery_city" text,
	"delivery_state" text,
	"stops_json" text DEFAULT '[]' NOT NULL,
	"route_label" text,
	"end_lat" double precision,
	"end_lon" double precision,
	"eta_at" timestamp with time zone,
	"published_at" timestamp with time zone NOT NULL
);
