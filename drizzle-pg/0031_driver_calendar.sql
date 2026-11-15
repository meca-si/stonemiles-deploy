-- Driver Calendar (Research Wave 2 item 10.5).
-- PG twin of drizzle/0138_driver_calendar.sql — see that file's
-- header. fleet_calendar_settings (owner's dispatch mode /
-- safety window / pay cycle), off_duty_requests (typed blocks +
-- the desk's decision + the commitment shadow id),
-- load_release_requests (release from a locked load),
-- load_reassignments (consent-gated moves, owner-only refusal
-- override), driver_load_handbacks (desk decisions a driver's
-- own session sweeps). No rate or money column on any table.
CREATE TABLE "fleet_calendar_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"dispatch_mode" text DEFAULT 'offered' NOT NULL,
	"safety_window_hours" integer DEFAULT 24 NOT NULL,
	"pay_cycle_kind" text DEFAULT 'none' NOT NULL,
	"pay_weekday" integer,
	"pay_anchor_on" text,
	"updated_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX "fleet_calendar_settings_company_id_unique" ON "fleet_calendar_settings" ("company_id");
CREATE TABLE "off_duty_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"driver_username" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"commitment_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "load_release_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"board_load_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "load_reassignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"board_load_id" integer NOT NULL,
	"from_driver" text NOT NULL,
	"to_driver" text NOT NULL,
	"proposed_by" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending_consent' NOT NULL,
	"responded_at" timestamp with time zone,
	"override_by" text,
	"override_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "driver_load_handbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"board_load_id" integer NOT NULL,
	"load_id" integer,
	"trip_queue_id" integer,
	"reason" text NOT NULL,
	"swept_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
