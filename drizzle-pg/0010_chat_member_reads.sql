-- Chat email alerts (2026-11-14): per-member chat read + alert state.
-- PG twin of drizzle/0117_chat_member_reads.sql — see that file's header.
CREATE TABLE "chat_member_reads" (
	"group_id" integer NOT NULL,
	"username" text NOT NULL,
	"last_read_id" integer DEFAULT 0 NOT NULL,
	"last_alerted_id" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY("group_id","username")
);
