-- Load identity fields (2026-11-24, x's live report): the load's own
-- number, street addresses, consignee, carrier, and notes become
-- real columns on the load. Until now the load number and the street
-- addresses existed only inside the rate-con snapshot — and only
-- when a document was attached — so a hand-typed LOAD # ("31229",
-- typed twice) and typed street addresses vanished on save, the
-- edit form reopened empty, and the print view fell back to the
-- internal id ("Load #2"). Consignee / carrier / notes had no home
-- at all. All nullable, additive only: existing rows (including the
-- live Jacksonville → Montgomery load) read null and stay untouched.
ALTER TABLE `loads` ADD COLUMN `load_number` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `pickup_address` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `delivery_address` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `consignee` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `carrier` text;
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `notes` text;
