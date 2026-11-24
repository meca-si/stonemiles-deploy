-- Geotab ELD connection (2026-11-24).
-- PG twin of drizzle/0142_geotab_connection.sql — see that file's
-- header. eld_connections gains provider_account (non-secret
-- provider account identifiers as JSON; the Geotab password rides
-- in the existing token_enc vault slot).
ALTER TABLE "eld_connections" ADD COLUMN "provider_account" text;
