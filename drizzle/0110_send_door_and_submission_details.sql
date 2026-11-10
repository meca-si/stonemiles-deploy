-- Send door (x, 2026-11-10): each fleet gets ONE standing door code
-- (broker_links.kind = "door") that any shipper or broker can open
-- with NO account: they name themselves (name, company, contact) in
-- the form and the load lands ONLY in that fleet's Broker Inbox as an
-- offered load. The desk accepts (a booked board load in that fleet)
-- or declines (rejected, kept on record) — a door offer never touches
-- the public board. The fleet controls the door: it exists only while
-- broker uploads are on for the scope, and regenerating rotates the
-- code (the old code dies the moment the new one is minted).
-- Submissions also gain the sender's contact and the booked load's
-- reference number + pickup / delivery appointments, which approval
-- carries onto the board post.
ALTER TABLE `broker_links` ADD COLUMN `kind` text DEFAULT 'broker' NOT NULL;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `sender_contact` text;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `reference_number` text;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `pickup_appt_at` integer;
--> statement-breakpoint
ALTER TABLE `broker_submissions` ADD COLUMN `delivery_appt_at` integer;
