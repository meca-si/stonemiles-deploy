-- Driver review of owner/dispatch HOS log corrections (audit B2,
-- owner's ruling 2026-11-15; B1+B2 build). One new table:
-- duty_correction_reviews — the working record of a driver's
-- acknowledge/dispute decision on a correction someone else made
-- to their log. The decision itself seals into the chain
-- (duty_correction_review, ids + state only); the driver's dispute
-- note lives ONLY in this table, never in a chain payload (the
-- pulse-survey house pattern). correction_id is the chain row id
-- of the duty_correction, unique: a correction is reviewed once.
CREATE TABLE `duty_correction_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`correction_id` integer NOT NULL,
	`target_username` text NOT NULL,
	`editor_username` text NOT NULL,
	`state` text NOT NULL,
	`dispute_note` text,
	`reviewed_by` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duty_correction_reviews_correction_id_unique` ON `duty_correction_reviews` (`correction_id`);
