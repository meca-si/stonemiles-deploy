-- Credential expiry alerts (TMS completion queue item 1, 2026-11-15):
-- CDL / medical card / TWIC alerts at 60 / 30 / 7 days + expired are
-- computed from the expiry dates the app already stores (personal_docs
-- for CDL + medical, social_users.twic_expires for TWIC) — this
-- migration adds ONLY the dismissal state that makes the alerts
-- stateful: one row per (driver, credential, threshold, expiry date)
-- dismissed. Keying the row to the expiry date means a renewed card
-- re-arms every threshold on its own; no cleanup job exists or is
-- needed.
CREATE TABLE `credential_alert_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`credential_key` text NOT NULL,
	`threshold` integer NOT NULL,
	`expires_on` text NOT NULL,
	`dismissed_at` integer NOT NULL
);
