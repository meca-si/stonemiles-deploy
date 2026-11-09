ALTER TABLE `board_loads` ADD COLUMN `board_scope` text DEFAULT 'fleet' NOT NULL;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `origin_kind` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `origin_label` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `origin_company_id` integer;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `vetted_only` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `overflow_reason` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `overflow_from_board_load_id` integer;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `broker_poster_load_id` integer;
--> statement-breakpoint
CREATE TABLE `broker_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`contact_name` text,
	`logo_initials` text,
	`broker_mc` text,
	`linked_username` text,
	`company_id` integer,
	`owner_username` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`default_pickup_address` text,
	`default_pickup_city` text,
	`default_pickup_state` text,
	`default_commodity` text,
	`default_freight_class` text,
	`default_contact_name` text,
	`default_contact_phone` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `broker_poster_loads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker_id` integer NOT NULL,
	`company_id` integer,
	`created_by` text NOT NULL,
	`reference_number` text,
	`pickup_address` text,
	`pickup_city` text,
	`pickup_state` text,
	`pickup_date` text,
	`pickup_window` text,
	`delivery_address` text,
	`delivery_city` text,
	`delivery_state` text,
	`delivery_date` text,
	`delivery_window` text,
	`commodity` text,
	`freight_class` text,
	`weight_lbs` integer,
	`pieces` integer,
	`dimensions` text,
	`equipment` text,
	`tarps` integer DEFAULT 0 NOT NULL,
	`edge_protectors` integer DEFAULT 0 NOT NULL,
	`rate` real,
	`rate_con_blob_key` text,
	`rate_con_mime` text,
	`rate_con_sha256` text,
	`signoff_confirmed` integer DEFAULT 0 NOT NULL,
	`offload_confirmed` integer DEFAULT 0 NOT NULL,
	`contact_name` text,
	`contact_phone` text,
	`notes` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`board_load_id` integer,
	`track_token` text,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
