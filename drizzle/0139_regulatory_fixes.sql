-- Regulatory audit fixes (owner's order 2026-11-15; audit:
-- regulatory-audit-2026-11-15.md). Four small column adds, no new
-- tables:
--   A3 (49 CFR 395.3(b)): the HOS cycle type is the CARRIER's
--   operating schedule — 60h/7-day or 70h/8-day. profile.cycle_type
--   is the driver's own setting (default '70/8' = the behaviour
--   before this migration, so nobody's hours change silently);
--   company_setup.cycle_type is the fleet override (null = no
--   override; when set it governs the company's drivers).
--   A1 (49 CFR 395.8(d)(5)): the driver's log certification —
--   the typed name + the moment it was given, on the daily log
--   row (the attestation itself is also sealed into the
--   daily_log_close / daily_log_certified chain payloads).
--   A5 (49 CFR 396.11(a)(2)): the carrier repair certification
--   on a DVIR defect — who certified, the determination
--   ('repaired' | 'repair_not_necessary'), and when — kept on
--   the defect's link row so the certification lives with the
--   DVIR record it belongs to.
ALTER TABLE `profile` ADD COLUMN `cycle_type` text DEFAULT '70/8' NOT NULL;
--> statement-breakpoint
ALTER TABLE `company_setup` ADD COLUMN `cycle_type` text;
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `certified_name` text;
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `certified_at` integer;
--> statement-breakpoint
ALTER TABLE `dvir_defect_links` ADD COLUMN `certified_by` text;
--> statement-breakpoint
ALTER TABLE `dvir_defect_links` ADD COLUMN `repair_determination` text;
--> statement-breakpoint
ALTER TABLE `dvir_defect_links` ADD COLUMN `certified_at` integer;
