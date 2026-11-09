CREATE TABLE `eld_identity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`provider` text NOT NULL,
	`driver_json` text NOT NULL,
	`truck_json` text NOT NULL,
	`pulled_at` integer NOT NULL
);
