-- Driver review of owner/dispatch HOS log corrections (audit B2,
-- owner's ruling 2026-11-15). PG twin of
-- drizzle/0140_duty_correction_reviews.sql — see that file's
-- header. The review decision seals into the chain (ids + state
-- only); the dispute note lives only in this table.
CREATE TABLE "duty_correction_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"correction_id" integer NOT NULL,
	"target_username" text NOT NULL,
	"editor_username" text NOT NULL,
	"state" text NOT NULL,
	"dispute_note" text,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duty_correction_reviews_correction_id_unique" UNIQUE("correction_id")
);
