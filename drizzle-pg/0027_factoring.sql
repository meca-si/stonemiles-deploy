-- Instant pay / factoring plumbing + broker credit. PG twin of
-- drizzle/0134_factoring.sql — see that file's header. The
-- factoring submission state on load_invoices (status, partner,
-- partner ref, package manifest, and the four transition
-- stamps); money rails stay staged OFF.
ALTER TABLE "load_invoices" ADD COLUMN "factor_status" text DEFAULT 'none' NOT NULL;
ALTER TABLE "load_invoices" ADD COLUMN "factor_partner" text;
ALTER TABLE "load_invoices" ADD COLUMN "factor_ref" text;
ALTER TABLE "load_invoices" ADD COLUMN "factor_package_json" text;
ALTER TABLE "load_invoices" ADD COLUMN "factor_packaged_at" timestamp with time zone;
ALTER TABLE "load_invoices" ADD COLUMN "factor_submitted_at" timestamp with time zone;
ALTER TABLE "load_invoices" ADD COLUMN "factor_advanced_at" timestamp with time zone;
ALTER TABLE "load_invoices" ADD COLUMN "factor_settled_at" timestamp with time zone;
