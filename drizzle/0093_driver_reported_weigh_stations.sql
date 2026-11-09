CREATE TABLE `driver_weigh_stations` (
	`station_id` text PRIMARY KEY NOT NULL,
	`station_name` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`reporter` text NOT NULL,
	`created_at` integer NOT NULL
);
