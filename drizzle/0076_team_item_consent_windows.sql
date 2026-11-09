CREATE TABLE `team_item_consent_windows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_username` text NOT NULL,
	`team_seat` text NOT NULL,
	`item_kind` text NOT NULL,
	`description` text NOT NULL,
	`note` text,
	`item_id` integer,
	`item_label` text,
	`can_edit` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`expires_at` integer,
	`closed_at` integer,
	`closeout_sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `team_item_access_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`window_id` integer NOT NULL,
	`seat` text NOT NULL,
	`access_kind` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
