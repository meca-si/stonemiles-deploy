CREATE TABLE `company_setup` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL,
  `legal_name` text,
  `dba` text,
  `address` text,
  `ein` text,
  `mc_number` text,
  `usdot_number` text,
  `contact_name` text,
  `contact_email` text,
  `contact_phone` text,
  `fleet_size` integer,
  `complete` integer DEFAULT 0 NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_docs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL,
  `subject_username` text NOT NULL,
  `kind` text NOT NULL,
  `filename` text NOT NULL,
  `mime` text,
  `blob_key` text NOT NULL,
  `status` text DEFAULT 'uploaded' NOT NULL,
  `expires_at` integer,
  `uploaded_at` integer NOT NULL
);
