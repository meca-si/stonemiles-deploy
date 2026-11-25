-- Driver's own calendar events (2026-11-24, x's report).
-- PG twin of drizzle/0145_calendar_events.sql — see that file's
-- header. calendar_events: the driver's free-form, self-owned
-- calendar entries (home_time | appointment | personal |
-- maintenance | other), rendered by getCalendar as "user_event".
CREATE TABLE "calendar_events" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
