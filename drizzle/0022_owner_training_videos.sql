CREATE TABLE `training_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`mime` text NOT NULL,
	`blob_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`course_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`quiz_course_id` text,
	`custom_check_json` text,
	`removed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_watch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`media_id` integer NOT NULL,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`check_passed` integer DEFAULT 0 NOT NULL,
	`chain_hash` text,
	`started_at` integer NOT NULL,
	`last_watched_at` integer NOT NULL,
	`completed_at` integer
);
