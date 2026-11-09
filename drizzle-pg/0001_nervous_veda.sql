CREATE TABLE "account_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"grant_plan" text,
	"invited_by_account_id" integer,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_account_id" integer,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"failed_signins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"last_signin_at" timestamp with time zone,
	"invite_kind" text,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_activity_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"actor_account_id" integer,
	"event" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_mail_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"link_token" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text DEFAULT '' NOT NULL,
	"user_agent" text,
	"ip_first_seen" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_via" text DEFAULT 'signin' NOT NULL,
	"pending_totp_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"purpose" text DEFAULT 'reset' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "breakdown_logs" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "claim_events" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "dvir_reports" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "eld_connections" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "eld_identity" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "eld_snapshots" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "filed_doc_copies" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "fleet_trucks" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "fuel_purchases" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "load_doc_exceptions" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "load_doc_extractions" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "load_doc_verifications" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "load_payments" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "maintenance_services" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "payment_packets" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "personal_docs" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "pickup_extra_photos" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "pretrip_inspections" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "recent_destinations" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "reefer_checks" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "saved_places" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "scale_tickets" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "trailer_swaps" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "trip_queue" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_account_id_unique" UNIQUE("account_id");