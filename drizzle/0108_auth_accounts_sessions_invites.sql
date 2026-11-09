-- Auth Phase 2b (AUTH-DESIGN.md S4/S9 step 1): accounts, sessions,
-- reset/claim tokens, account invites, auth audit, mail queue, tester
-- activity days; profile.account_id link; profile_id owner column +
-- backfill-to-owner on the private shape-(c) tables (S1.3/S4.4).
ALTER TABLE `profile` ADD COLUMN `account_id` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_account_id_unique` ON `profile` (`account_id`);
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `trips` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `trips_profile_id_idx` ON `trips` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `trip_queue` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `trip_queue` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `trip_queue_profile_id_idx` ON `trip_queue` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `loads` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `loads` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `loads_profile_id_idx` ON `loads` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `expenses` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `expenses` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `expenses_profile_id_idx` ON `expenses` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `settlements` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `settlements` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `settlements_profile_id_idx` ON `settlements` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `scale_tickets` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `scale_tickets` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `scale_tickets_profile_id_idx` ON `scale_tickets` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `personal_docs` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `personal_docs` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `personal_docs_profile_id_idx` ON `personal_docs` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `dvir_reports` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `dvir_reports` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `dvir_reports_profile_id_idx` ON `dvir_reports` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `pretrip_inspections` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `pretrip_inspections` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `pretrip_inspections_profile_id_idx` ON `pretrip_inspections` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `reefer_checks` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `reefer_checks` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `reefer_checks_profile_id_idx` ON `reefer_checks` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `fuel_purchases` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `fuel_purchases` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `fuel_purchases_profile_id_idx` ON `fuel_purchases` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `saved_places` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `saved_places` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `saved_places_profile_id_idx` ON `saved_places` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `recent_destinations` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `recent_destinations` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `recent_destinations_profile_id_idx` ON `recent_destinations` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `eld_connections` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `eld_connections` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `eld_connections_profile_id_idx` ON `eld_connections` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `eld_identity` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `eld_identity` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `eld_identity_profile_id_idx` ON `eld_identity` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `eld_snapshots` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `eld_snapshots` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `eld_snapshots_profile_id_idx` ON `eld_snapshots` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `fleet_trucks` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `fleet_trucks` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `fleet_trucks_profile_id_idx` ON `fleet_trucks` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `payment_packets` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `payment_packets` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `payment_packets_profile_id_idx` ON `payment_packets` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `filed_doc_copies` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `filed_doc_copies` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `filed_doc_copies_profile_id_idx` ON `filed_doc_copies` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `load_doc_extractions` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `load_doc_extractions` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `load_doc_extractions_profile_id_idx` ON `load_doc_extractions` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `load_doc_verifications` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `load_doc_verifications` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `load_doc_verifications_profile_id_idx` ON `load_doc_verifications` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `load_doc_exceptions` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `load_doc_exceptions` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `load_doc_exceptions_profile_id_idx` ON `load_doc_exceptions` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `pickup_extra_photos` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `pickup_extra_photos` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `pickup_extra_photos_profile_id_idx` ON `pickup_extra_photos` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `trailer_swaps` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `trailer_swaps` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `trailer_swaps_profile_id_idx` ON `trailer_swaps` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `maintenance_services` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `maintenance_services` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `maintenance_services_profile_id_idx` ON `maintenance_services` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `breakdown_logs` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `breakdown_logs` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `breakdown_logs_profile_id_idx` ON `breakdown_logs` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `claim_events` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `claim_events` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `claim_events_profile_id_idx` ON `claim_events` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `load_payments` ADD COLUMN `profile_id` integer;
--> statement-breakpoint
UPDATE `load_payments` SET `profile_id` = 1 WHERE `profile_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `load_payments_profile_id_idx` ON `load_payments` (`profile_id`);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`failed_signins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`email_verified_at` integer,
	`last_signin_at` integer,
	`invite_kind` text,
	`trial_ends_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_one_owner_idx` ON `accounts` (`is_owner`) WHERE `is_owner` = 1;
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`device_label` text DEFAULT '' NOT NULL,
	`user_agent` text,
	`ip_first_seen` text,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_via` text DEFAULT 'signin' NOT NULL,
	`pending_totp_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_account_idx` ON `auth_sessions` (`account_id`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`purpose` text DEFAULT 'reset' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`superseded_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `pw_reset_account_idx` ON `password_reset_tokens` (`account_id`);
--> statement-breakpoint
CREATE TABLE `account_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`grant_plan` text,
	`invited_by_account_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_account_id` integer,
	`accepted_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_invites_token_hash_unique` ON `account_invites` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `account_invites_email_idx` ON `account_invites` (`email`);
--> statement-breakpoint
CREATE TABLE `auth_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer,
	`actor_account_id` integer,
	`event` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_audit_account_idx` ON `auth_audit_log` (`account_id`);
--> statement-breakpoint
CREATE INDEX `auth_audit_event_idx` ON `auth_audit_log` (`event`);
--> statement-breakpoint
CREATE TABLE `auth_mail_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer,
	`kind` text NOT NULL,
	`to_email` text NOT NULL,
	`link_token` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_activity_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_activity_account_day_unique` ON `auth_activity_days` (`account_id`, `day`);
