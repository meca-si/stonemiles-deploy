-- Credential expiry alerts. PG twin of drizzle/0125_credential_alerts.sql
-- — see that file's header. Adds only the per-threshold dismissal
-- state (credential_alert_dismissals); expiry dates stay in
-- personal_docs (CDL / medical) and social_users (TWIC).
CREATE TABLE "credential_alert_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"credential_key" text NOT NULL,
	"threshold" integer NOT NULL,
	"expires_on" text NOT NULL,
	"dismissed_at" timestamp with time zone NOT NULL
);
