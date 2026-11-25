-- Driver's own calendar events (2026-11-24, x's report: "The
-- calendar doesn't let users add or delete or edit anything
-- either. I wanted to add my home time but couldn't.").
-- calendar_events is the driver's free-form layer on the Schedule
-- calendar: an entry he adds, edits, and deletes himself — home
-- time, an appointment, a personal block, a maintenance window —
-- with no desk approval and no commitment shadow (that machinery
-- stays with off_duty_requests). Owned by profile_id (host-stamped
-- on insert, host-filtered on read — host/ctx.ts scopedDb) and
-- rendered by getCalendar as kind "user_event" alongside the
-- load-derived appointments, which stay owned by their loads.
CREATE TABLE `calendar_events` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
