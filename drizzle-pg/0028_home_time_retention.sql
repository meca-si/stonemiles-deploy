-- Home-time guarantee + retention.
-- PG twin of drizzle/0135_home_time_retention.sql — see that
-- file's header. home_time_commitments (the driver-stated term:
-- by_date / every_n_days / weekends, void-and-replace),
-- home_time_overrides (one sealed row per knowing break at a
-- binding funnel), pulse_responses (one row per driver per
-- 14-day pulse episode; fleet aggregates only at 3+ respondents).
CREATE TABLE "home_time_commitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"kind" text NOT NULL,
	"home_by_at" timestamp with time zone,
	"every_n_days" integer,
	"anchor_at" timestamp with time zone,
	"set_by" text NOT NULL,
	"created_by" text NOT NULL,
	"note" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "home_time_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"commitment_id" integer NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"board_load_id" integer NOT NULL,
	"load_id" integer,
	"method" text NOT NULL,
	"overridden_by" text NOT NULL,
	"reason" text NOT NULL,
	"delivery_at" timestamp with time zone,
	"home_eta_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "pulse_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"episode_key" text NOT NULL,
	"status" text NOT NULL,
	"answers_json" text DEFAULT '{}' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "home_time_fact_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"driver_username" text NOT NULL,
	"detention_overruns90" integer DEFAULT 0 NOT NULL,
	"miles_recent30" double precision DEFAULT 0 NOT NULL,
	"miles_prior30" double precision DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
