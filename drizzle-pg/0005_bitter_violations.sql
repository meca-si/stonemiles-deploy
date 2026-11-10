CREATE TABLE "receive_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"token" text NOT NULL,
	"kind" text DEFAULT 'action' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "receive_links_token_unique" UNIQUE("token")
);
