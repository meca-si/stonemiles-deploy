-- Rewards Layer 2 + safety net. PG twin of drizzle/0124_points_layer2.sql
-- — see that file's header. profile gains birth_month / birth_day
-- (month + day only; no birth year exists anywhere by design), and
-- points_safety_holds carries the suspected-farming holds.
ALTER TABLE "profile" ADD COLUMN "birth_month" integer;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "birth_day" integer;
--> statement-breakpoint
CREATE TABLE "points_safety_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
