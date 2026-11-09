CREATE TABLE `saved_places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'custom' NOT NULL,
	`address_label` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`gate_lat` real,
	`gate_lon` real,
	`gate_label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recent_destinations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`gate_lat` real,
	`gate_lon` real,
	`use_count` integer DEFAULT 1 NOT NULL,
	`last_used_at` integer NOT NULL
);
