-- Beta join requests (x's order, 2026-11-11: ONE public join link +
-- owner approval instead of one-by-one invite emails). PG twin of
-- drizzle/0114_beta_join_requests.sql — see that file's header.
CREATE TABLE "beta_join_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" integer,
	"invite_id" integer,
	"mail_queue_id" integer
);
--> statement-breakpoint
CREATE INDEX "beta_join_requests_email_status_idx" ON "beta_join_requests" ("email","status");
--> statement-breakpoint
CREATE INDEX "beta_join_requests_status_idx" ON "beta_join_requests" ("status");
