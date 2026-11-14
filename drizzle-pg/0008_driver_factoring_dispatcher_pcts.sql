-- Driver's OWN factoring / dispatcher percentages. PG twin of
-- drizzle/0115_driver_factoring_dispatcher_pcts.sql — see that
-- file's header. Percent of a load's gross pay, 0–100, default 0;
-- the driver's own costs, never platform fees.
ALTER TABLE "profile" ADD COLUMN "factoring_pct" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "dispatcher_pct" double precision DEFAULT 0 NOT NULL;
