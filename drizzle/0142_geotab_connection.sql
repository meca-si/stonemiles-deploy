-- Geotab ELD connection (2026-11-24): eld_connections gains
-- provider_account — the NON-SECRET provider account identifiers as
-- JSON (Geotab: { server, database, username }). Geotab has no API
-- token; the MyGeotab password itself rides in the existing
-- token_enc vault slot, masked by token_last4 and wiped on revoke
-- exactly like a token. Token providers leave this null.
ALTER TABLE `eld_connections` ADD COLUMN `provider_account` text;
