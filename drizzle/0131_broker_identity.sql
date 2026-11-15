-- Broker-grade identity + continuous monitoring (Research Wave 2
-- item 3, 2026-11-15).
-- broker_accounts gains the identity record: legal business name,
-- the BMC-84 bond (carrier / amount / expiry date), the authority
-- status as recorded, and the verification stamp — written ONLY by
-- a completed source check (the brokerIdentity.ts seam; no provider
-- is connected in this build, so nothing is stamped and unchecked
-- records read "on file", never "verified"). The bond amount lives
-- here and in the broker's own 371.3 record file only; the
-- carrier-facing trust summary shows bond status + expiry month.
-- broker_poster_loads gains the tender-screen stamp (when a tender
-- passed + the facts as they stood); a blocked tender stamps
-- nothing. board_loads gains carrier_of_record — the account bound
-- to a taken load (anti-double-brokering). broker_bond_alert_
-- dismissals mirrors credential_alert_dismissals for the bond:
-- (broker account, threshold, expiry date) — a renewal re-arms.
ALTER TABLE `broker_accounts` ADD COLUMN `legal_name` text;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `bond_carrier` text;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `bond_amount` real;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `bond_expires_on` text;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `authority_status` text DEFAULT 'not_recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `identity_verified_at` integer;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `identity_source` text;
--> statement-breakpoint
ALTER TABLE `broker_accounts` ADD COLUMN `identity_facts_json` text;
--> statement-breakpoint
ALTER TABLE `broker_poster_loads` ADD COLUMN `identity_screened_at` integer;
--> statement-breakpoint
ALTER TABLE `broker_poster_loads` ADD COLUMN `identity_screen_json` text;
--> statement-breakpoint
ALTER TABLE `board_loads` ADD COLUMN `carrier_of_record` text;
--> statement-breakpoint
CREATE TABLE `broker_bond_alert_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`broker_account_id` integer NOT NULL,
	`threshold` integer NOT NULL,
	`expires_on` text NOT NULL,
	`dismissed_at` integer NOT NULL
);
