-- Driver's OWN factoring / dispatcher percentages (x's order,
-- 2026-11-13: "Add the % fields first" — a LoadIntel check showed a
-- load can look good on rate alone while the driver's own factoring
-- (typically ~2–3%) and dispatcher (~5–10%) cuts quietly eat it).
-- Two saved settings on the profile row, percent of a load's gross
-- pay, 0–100, default 0 (= no deduction, pre-0115 behaviour). These
-- are the DRIVER'S OWN costs with THEIR factoring company / THEIR
-- dispatcher — never the platform's internal fees, which live
-- elsewhere and are untouched by this migration. The Worth-It
-- Advisor deducts them from a load's gross before scoring; True
-- Rate shows them per load.
ALTER TABLE `profile` ADD COLUMN `factoring_pct` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `dispatcher_pct` real DEFAULT 0 NOT NULL;
