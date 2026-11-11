-- Beta join requests (x's order, 2026-11-11: ONE public join link +
-- owner approval instead of one-by-one invite emails). The public
-- /join form writes rows here and NOTHING else — a request creates no
-- account, no session, no invite (D2 registration stays invite-only).
-- The owner approves or denies from the Owner desk; approval mints a
-- tester invite through the exact POST /auth/invites machinery and
-- links it back here (invite_id + the mail-queue row it produced).
-- Dedupe is enforced in the submit handler: at most one PENDING row
-- per email; emails with an account or a live invite absorb silently.
CREATE TABLE `beta_join_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` integer,
	`invite_id` integer,
	`mail_queue_id` integer
);
--> statement-breakpoint
CREATE INDEX `beta_join_requests_email_status_idx` ON `beta_join_requests` (`email`, `status`);
--> statement-breakpoint
CREATE INDEX `beta_join_requests_status_idx` ON `beta_join_requests` (`status`);
