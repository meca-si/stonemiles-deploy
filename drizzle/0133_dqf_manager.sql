-- Driver qualification file (DQF) manager (Research Wave 2
-- item 6, 2026-11-15) — the 49 CFR 391.51 file per (company,
-- driver). dqf_files is the folder; dqf_entries are the recorded
-- facts inside it (application, CDL, medical certificate, road
-- test, MVR reviews, Clearinghouse queries, employment history,
-- violations, training, medical verification checks). Standing
-- is DERIVED from the entries by the pure evaluator in dqf.ts —
-- no qualification claim is stored. Entries are corrected by
-- voiding + re-recording, never edited or deleted. Clearinghouse
-- entries are the fleet's record of queries THEY ran at FMCSA;
-- a medical verification entry exists only when a verification
-- source actually answered (the medicalVerifierFromEnv seam).
-- dqf_alert_dismissals carries the credential dismissal pattern
-- (item, threshold, date) to the fleet-side expiry alerts.
CREATE TABLE `dqf_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dqf_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`kind` text NOT NULL,
	`entry_date` text NOT NULL,
	`expires_on` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`doc_blob_key` text,
	`doc_mime` text,
	`recorded_by` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dqf_alert_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`driver_username` text NOT NULL,
	`item_key` text NOT NULL,
	`threshold` integer NOT NULL,
	`expires_on` text NOT NULL,
	`dismissed_by` text NOT NULL,
	`dismissed_at` integer NOT NULL
);
