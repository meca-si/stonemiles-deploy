-- Receive links (owner order, 2026-11-10): every booked load gets a
-- per-load receive link at booking — an unguessable token URL, no
-- login — printed as a QR code + short URL on the BOL. The receiver
-- confirms delivery from their own phone (typed name as signature,
-- exception notes, optional dock photo); the confirmation seals into
-- the load's hash chain and closes the delivery. kind "copy" rows
-- are the receiver's separate VIEW-ONLY copy-link tokens (their own
-- POD copy; no action rights). The desk revokes/regenerates the
-- action token; a used token goes view-only (receipt view).
CREATE TABLE `receive_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`load_id` integer NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL DEFAULT 'action',
	`status` text NOT NULL DEFAULT 'active',
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receive_links_token_unique` ON `receive_links` (`token`);
--> statement-breakpoint
CREATE INDEX `receive_links_load_idx` ON `receive_links` (`load_id`, `kind`, `status`);
