CREATE TABLE "account_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" integer DEFAULT 0 NOT NULL,
	"device_label" text DEFAULT '' NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
