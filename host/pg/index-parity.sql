-- Phase 2a — index parity for the Postgres migration set.
--
-- drizzle-kit generates tables from server/src/schema-pg.ts, which
-- declares NO standalone indexes (the SQLite schema never did
-- either — its indexes were created by hand-written migrations).
-- The 25 explicit indexes below are the ground truth read from
-- sqlite_master of the live-data copy (24 unique + 1 plain),
-- converted from SQLite backtick quoting to Postgres quoting and
-- made idempotent. Column-level .unique() in the schema (22)
-- arrives separately as UNIQUE constraints in the generated
-- migration; sqlite_autoindex entries (19) are their SQLite
-- backing indexes and are intentionally not duplicated here.
-- Applied by host/migrate-pg.ts after the drizzle migrator.

CREATE UNIQUE INDEX IF NOT EXISTS "app_health_reports_fingerprint_unique" ON "app_health_reports" ("fingerprint");
CREATE UNIQUE INDEX IF NOT EXISTS "board_likes_post_user" ON "board_likes" ("post_id", "username");
CREATE UNIQUE INDEX IF NOT EXISTS "broker_links_token_unique" ON "broker_links" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_fee_invoices_load_id_unique" ON "dispatch_fee_invoices" ("load_id");
CREATE UNIQUE INDEX IF NOT EXISTS "doc_copy_settings_username_unique" ON "doc_copy_settings" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "doc_email_deliveries_dedupe_key_unique" ON "doc_email_deliveries" ("dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "earning_pool_backing_ledger_ref_key_unique" ON "earning_pool_backing_ledger" ("ref_key");
CREATE UNIQUE INDEX IF NOT EXISTS "earning_pool_ledger_ref_key_unique" ON "earning_pool_ledger" ("ref_key");
CREATE UNIQUE INDEX IF NOT EXISTS "eia_diesel_snapshots_week_of_unique" ON "eia_diesel_snapshots" ("week_of");
CREATE UNIQUE INDEX IF NOT EXISTS "filed_doc_copies_dedupe_key_unique" ON "filed_doc_copies" ("dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_registry_fingerprint_unique" ON "invoice_registry" ("fingerprint");
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_services_item_unique" ON "maintenance_services" ("item");
CREATE UNIQUE INDEX IF NOT EXISTS "market_pulse_weeks_week_ending_unique" ON "market_pulse_weeks" ("week_ending");
CREATE UNIQUE INDEX IF NOT EXISTS "pay_stub_email_deliveries_dedupe_key_unique" ON "pay_stub_email_deliveries" ("dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_ledger_idempotency_key_unique" ON "payment_ledger" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_packets_load_id_unique" ON "payment_packets" ("load_id");
CREATE INDEX IF NOT EXISTS "perf_events_user_created_idx" ON "perf_events" ("username", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "platform_fee_entries_load_id_unique" ON "platform_fee_entries" ("load_id");
CREATE UNIQUE INDEX IF NOT EXISTS "receivable_registry_receivable_key_unique" ON "receivable_registry" ("receivable_key");
CREATE UNIQUE INDEX IF NOT EXISTS "referral_milestones_referrer_level_idx" ON "referral_milestones" ("referrer_username","level_key");
CREATE UNIQUE INDEX IF NOT EXISTS "reward_wallet_ledger_ref_key_unique" ON "reward_wallet_ledger" ("ref_key");
CREATE UNIQUE INDEX IF NOT EXISTS "si_events_dedupe_key_unique" ON "si_events" ("dedupe_key");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_payment_ref_unique" ON "subscription_events" ("payment_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "team_invite_codes_code_unique" ON "team_invite_codes" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "verify_codes_code_unique" ON "verify_codes" ("code");

-- Phase 2 merge — auth (Phase 2b) index parity. These indexes exist
-- only in the hand-written SQLite migration drizzle/0108 (the schema
-- declares no standalone indexes), so they are ported here in
-- Postgres syntax, mirroring 0108 exactly. The 0108 backfill UPDATEs
-- are NOT ported: on Postgres they are performed by the transfer
-- tool (host/pg/transfer.ts) after the data move.
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_one_owner_idx" ON "accounts" ("is_owner") WHERE "is_owner" = true;
CREATE INDEX IF NOT EXISTS "breakdown_logs_profile_id_idx" ON "breakdown_logs" ("profile_id");
CREATE INDEX IF NOT EXISTS "claim_events_profile_id_idx" ON "claim_events" ("profile_id");
CREATE INDEX IF NOT EXISTS "dvir_reports_profile_id_idx" ON "dvir_reports" ("profile_id");
CREATE INDEX IF NOT EXISTS "eld_connections_profile_id_idx" ON "eld_connections" ("profile_id");
CREATE INDEX IF NOT EXISTS "eld_identity_profile_id_idx" ON "eld_identity" ("profile_id");
CREATE INDEX IF NOT EXISTS "eld_snapshots_profile_id_idx" ON "eld_snapshots" ("profile_id");
CREATE INDEX IF NOT EXISTS "expenses_profile_id_idx" ON "expenses" ("profile_id");
CREATE INDEX IF NOT EXISTS "filed_doc_copies_profile_id_idx" ON "filed_doc_copies" ("profile_id");
CREATE INDEX IF NOT EXISTS "fleet_trucks_profile_id_idx" ON "fleet_trucks" ("profile_id");
CREATE INDEX IF NOT EXISTS "fuel_purchases_profile_id_idx" ON "fuel_purchases" ("profile_id");
CREATE INDEX IF NOT EXISTS "load_doc_exceptions_profile_id_idx" ON "load_doc_exceptions" ("profile_id");
CREATE INDEX IF NOT EXISTS "load_doc_extractions_profile_id_idx" ON "load_doc_extractions" ("profile_id");
CREATE INDEX IF NOT EXISTS "load_doc_verifications_profile_id_idx" ON "load_doc_verifications" ("profile_id");
CREATE INDEX IF NOT EXISTS "load_payments_profile_id_idx" ON "load_payments" ("profile_id");
CREATE INDEX IF NOT EXISTS "loads_profile_id_idx" ON "loads" ("profile_id");
CREATE INDEX IF NOT EXISTS "maintenance_services_profile_id_idx" ON "maintenance_services" ("profile_id");
CREATE INDEX IF NOT EXISTS "payment_packets_profile_id_idx" ON "payment_packets" ("profile_id");
CREATE INDEX IF NOT EXISTS "personal_docs_profile_id_idx" ON "personal_docs" ("profile_id");
CREATE INDEX IF NOT EXISTS "pickup_extra_photos_profile_id_idx" ON "pickup_extra_photos" ("profile_id");
CREATE INDEX IF NOT EXISTS "pretrip_inspections_profile_id_idx" ON "pretrip_inspections" ("profile_id");
CREATE INDEX IF NOT EXISTS "recent_destinations_profile_id_idx" ON "recent_destinations" ("profile_id");
CREATE INDEX IF NOT EXISTS "reefer_checks_profile_id_idx" ON "reefer_checks" ("profile_id");
CREATE INDEX IF NOT EXISTS "saved_places_profile_id_idx" ON "saved_places" ("profile_id");
CREATE INDEX IF NOT EXISTS "scale_tickets_profile_id_idx" ON "scale_tickets" ("profile_id");
CREATE INDEX IF NOT EXISTS "settlements_profile_id_idx" ON "settlements" ("profile_id");
CREATE INDEX IF NOT EXISTS "trailer_swaps_profile_id_idx" ON "trailer_swaps" ("profile_id");
CREATE INDEX IF NOT EXISTS "trip_queue_profile_id_idx" ON "trip_queue" ("profile_id");
CREATE INDEX IF NOT EXISTS "trips_profile_id_idx" ON "trips" ("profile_id");
CREATE INDEX IF NOT EXISTS "auth_sessions_account_idx" ON "auth_sessions" ("account_id");
CREATE INDEX IF NOT EXISTS "auth_sessions_expires_idx" ON "auth_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "pw_reset_account_idx" ON "password_reset_tokens" ("account_id");
CREATE INDEX IF NOT EXISTS "account_invites_email_idx" ON "account_invites" ("email");
CREATE INDEX IF NOT EXISTS "auth_audit_account_idx" ON "auth_audit_log" ("account_id");
CREATE INDEX IF NOT EXISTS "auth_audit_event_idx" ON "auth_audit_log" ("event");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_activity_account_day_unique" ON "auth_activity_days" ("account_id", "day");
