-- Regulatory audit fixes (owner's order 2026-11-15).
-- PG twin of drizzle/0139_regulatory_fixes.sql — see that file's
-- header. A3 cycle type (profile default '70/8' + company_setup
-- fleet override), A1 daily-log certification columns, A5 DVIR
-- repair-certification columns on the defect link row.
ALTER TABLE "profile" ADD COLUMN "cycle_type" text DEFAULT '70/8' NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_setup" ADD COLUMN "cycle_type" text;
--> statement-breakpoint
ALTER TABLE "daily_logs" ADD COLUMN "certified_name" text;
--> statement-breakpoint
ALTER TABLE "daily_logs" ADD COLUMN "certified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "dvir_defect_links" ADD COLUMN "certified_by" text;
--> statement-breakpoint
ALTER TABLE "dvir_defect_links" ADD COLUMN "repair_determination" text;
--> statement-breakpoint
ALTER TABLE "dvir_defect_links" ADD COLUMN "certified_at" timestamp with time zone;
