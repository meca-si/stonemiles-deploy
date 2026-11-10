-- Social sign-in + passkeys (x's order, 2026-11-10: "Google now, Apple
-- ready, Face ID too"). Two new auth tables:
--   account_identities — linked Google/Apple identities. The stable
--     key is (provider, provider_subject): the provider's subject id,
--     never the email (emails change; subjects don't). Same email =
--     same account: a verified social email matching an existing
--     account LINKS to it — no duplicate accounts are ever created.
--   passkey_credentials — WebAuthn credentials for "Sign in with Face
--     ID". PUBLIC keys only (COSE, base64url); biometric data never
--     leaves the user's device and is never stored here.
CREATE TABLE `account_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text NOT NULL,
	`linked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_identities_provider_subject_unique` ON `account_identities` (`provider`, `provider_subject`);
--> statement-breakpoint
CREATE INDEX `account_identities_account_idx` ON `account_identities` (`account_id`);
--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`device_label` text DEFAULT '' NOT NULL,
	`transports` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentials_credential_id_unique` ON `passkey_credentials` (`credential_id`);
--> statement-breakpoint
CREATE INDEX `passkey_credentials_account_idx` ON `passkey_credentials` (`account_id`);
