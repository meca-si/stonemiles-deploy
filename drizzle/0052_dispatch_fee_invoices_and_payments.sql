CREATE TABLE `dispatch_fee_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`board_load_id` integer,
	`packet_id` integer,
	`company_id` integer NOT NULL,
	`carrier_username` text NOT NULL,
	`freight_amount` real NOT NULL,
	`fee_amount` real NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`delivered_at` integer NOT NULL,
	`paid_at` integer,
	`probe` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dispatch_fee_invoices_load_id_unique` ON `dispatch_fee_invoices` (`load_id`);
--> statement-breakpoint
CREATE TABLE `dispatch_fee_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`load_id` integer NOT NULL,
	`rail` text NOT NULL,
	`reference` text NOT NULL,
	`amount` real NOT NULL,
	`paid_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`verification` text NOT NULL DEFAULT 'admin_confirmed',
	`note` text,
	`created_at` integer NOT NULL
);
