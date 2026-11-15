-- Fleet visibility + outward sharing (TMS completion queue item 4,
-- 2026-11-15; gap-tools-spec items 4–5).
-- driver_fleet_status: the share-up pipe. A driver's app publishes
-- a snapshot of the load they are running (lane, status, ordered
-- stop labels, route end city + coordinates off their own planned
-- route, ETA) into this shared, username-keyed table so the fleet's
-- owner + dispatch seats can read it. The driver's private load
-- rows never leave their profile scope; the snapshot is what
-- crosses. NO rate and NO money column by construction — the fleet
-- board and the outward track share both read from here, and the
-- rate law holds on both. One row per driver; load_id null = no
-- active load published. The outward share links themselves ride
-- the existing receive_links table as a new kind ("track") — no
-- schema change needed there.
CREATE TABLE `driver_fleet_status` (
	`username` text PRIMARY KEY NOT NULL,
	`load_id` integer,
	`load_status` text,
	`pickup_city` text,
	`pickup_state` text,
	`delivery_city` text,
	`delivery_state` text,
	`stops_json` text DEFAULT '[]' NOT NULL,
	`route_label` text,
	`end_lat` real,
	`end_lon` real,
	`eta_at` integer,
	`published_at` integer NOT NULL
);
