-- Points earning lanes. PG twin of drizzle/0121_points_earning_lanes.sql
-- — see that file's header. poster_referrals (Lane 3 poster referral
-- bookkeeping), sealed_lanes (first-sealed-lane registry), and the
-- reporter stamp on manual fuel price reports (Lane 2).
CREATE TABLE "poster_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_username" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"landed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sealed_lanes" (
	"lane_key" text PRIMARY KEY NOT NULL,
	"first_username" text NOT NULL,
	"first_load_id" integer NOT NULL,
	"first_sealed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_price_reports" ADD COLUMN "reporter" text;
