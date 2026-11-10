-- Library document sends (x, 2026-11-10): every Library item can be
-- printed, downloaded, or emailed as a document. Email is a NEW mail
-- kind (document mail): user-initiated, PDF attached, From = the app's
-- mail identity, Reply-To = the sending user's own address. This
-- table is the audit trail and the queue in one (D1 mechanics): a row
-- reads "sent" only with a provider id from the transport; an
-- unconfigured transport leaves the row "queued". The matching sealed
-- record is the document_emailed chain event.
CREATE TABLE `document_sends` (
	`profile_id` integer,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`doc_ref` text NOT NULL,
	`doc_kind` text NOT NULL,
	`doc_title` text NOT NULL,
	`to_email` text NOT NULL,
	`reply_to` text,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`detail` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
