-- Offline mode + ELD sync + push plumbing. PG twin of
-- drizzle/0128_offline_notifications_push.sql — see that file's
-- header. offline_captures is the offline sync ledger (composite
-- PK = the idempotency key), notifications is the in-app
-- notification center (push_state carries the honest device-push
-- outcome; FCM wires in with the Android build), push_devices
-- holds the device-token registrations that build will use.
CREATE TABLE "offline_captures" (
	"username" text NOT NULL,
	"capture_id" text NOT NULL,
	"kind" text NOT NULL,
	"chain_hash" text,
	"result_json" text,
	"captured_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	PRIMARY KEY("username","capture_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text,
	"ref_kind" text,
	"ref_id" integer,
	"count" integer DEFAULT 1 NOT NULL,
	"push_state" text DEFAULT 'not_configured' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"token" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"platform" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone
);
