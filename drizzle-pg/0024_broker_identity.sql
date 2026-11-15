-- Broker-grade identity + continuous monitoring. PG twin of
-- drizzle/0131_broker_identity.sql — see that file's header. The
-- broker identity record (legal name, BMC-84 bond, recorded
-- authority status, verification stamp), the tender-screen stamp
-- on broker_poster_loads, carrier_of_record on board_loads, and
-- the bond alert dismissal ledger.
ALTER TABLE "broker_accounts" ADD COLUMN "legal_name" text;
ALTER TABLE "broker_accounts" ADD COLUMN "bond_carrier" text;
ALTER TABLE "broker_accounts" ADD COLUMN "bond_amount" double precision;
ALTER TABLE "broker_accounts" ADD COLUMN "bond_expires_on" text;
ALTER TABLE "broker_accounts" ADD COLUMN "authority_status" text DEFAULT 'not_recorded' NOT NULL;
ALTER TABLE "broker_accounts" ADD COLUMN "identity_verified_at" timestamp with time zone;
ALTER TABLE "broker_accounts" ADD COLUMN "identity_source" text;
ALTER TABLE "broker_accounts" ADD COLUMN "identity_facts_json" text;
ALTER TABLE "broker_poster_loads" ADD COLUMN "identity_screened_at" timestamp with time zone;
ALTER TABLE "broker_poster_loads" ADD COLUMN "identity_screen_json" text;
ALTER TABLE "board_loads" ADD COLUMN "carrier_of_record" text;
CREATE TABLE "broker_bond_alert_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"broker_account_id" integer NOT NULL,
	"threshold" integer NOT NULL,
	"expires_on" text NOT NULL,
	"dismissed_at" timestamp with time zone NOT NULL
);
