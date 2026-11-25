-- Load identity fields (2026-11-24, x's live report).
-- PG twin of drizzle/0144_load_identity_fields.sql — see that file's
-- header. loads gains load_number / pickup_address /
-- delivery_address / consignee / carrier / notes, all nullable.
ALTER TABLE "loads" ADD COLUMN "load_number" text;
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "pickup_address" text;
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "delivery_address" text;
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "consignee" text;
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "carrier" text;
--> statement-breakpoint
ALTER TABLE "loads" ADD COLUMN "notes" text;
