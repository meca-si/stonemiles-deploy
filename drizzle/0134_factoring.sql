-- Instant pay / factoring plumbing + broker credit (Research
-- Wave 2 item 7, 2026-11-15). load_invoices gains the factoring
-- submission state: none | packaged | submitted | advanced |
-- settled, every transition chain-sealed by the actions. The
-- package manifest (factor_package_json) names the Library refs
-- the package stands on (invoice:<id> + pod:<loadId>) and the
-- POD confirmation facts. factor_partner / factor_ref are
-- written ONLY by an accepted partner submission through the
-- factorPartnerFromEnv seam — unconfigured in this build, so
-- "packaged" is as far as any invoice gets until a real factor
-- agreement lands. Money rails stay staged OFF: no column here
-- moves money, and no fee figure exists anywhere in the lane
-- (no partner terms are on file to price one from).
ALTER TABLE `load_invoices` ADD COLUMN `factor_status` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_partner` text;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_ref` text;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_package_json` text;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_packaged_at` integer;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_submitted_at` integer;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_advanced_at` integer;
--> statement-breakpoint
ALTER TABLE `load_invoices` ADD COLUMN `factor_settled_at` integer;
