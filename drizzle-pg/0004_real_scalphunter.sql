CREATE TABLE "document_sends" (
	"profile_id" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"doc_ref" text NOT NULL,
	"doc_kind" text NOT NULL,
	"doc_title" text NOT NULL,
	"to_email" text NOT NULL,
	"reply_to" text,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"detail" text,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
