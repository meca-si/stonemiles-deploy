-- Per-payer PAY LAG for the settlement check (owner's build,
-- 2026-11-15). PG twin of drizzle/0141_payer_pay_lag.sql — see
-- that file's header. One row per (driver, payer); drives every
-- automatic settlement-check window for the payer.
CREATE TABLE "payer_pay_lag" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"payer_key" text NOT NULL,
	"payer" text NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payer_pay_lag_username_payer_key_unique" UNIQUE("username","payer_key")
);
--> statement-breakpoint
-- Per-entry settlement-check overrides (same build) — see the
-- SQLite twin's header. One row per (driver, pay entry).
CREATE TABLE "pay_entry_check_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"pay_entry_id" integer NOT NULL,
	"window_from_at" timestamp with time zone,
	"window_to_at" timestamp with time zone,
	"excluded_load_ids" text,
	"included_load_ids" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pay_entry_check_overrides_username_entry_unique" UNIQUE("username","pay_entry_id")
);
