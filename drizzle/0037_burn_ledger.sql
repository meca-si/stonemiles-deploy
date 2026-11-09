CREATE TABLE `burn_ledger` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `amount_stoner` real NOT NULL,
  `username` text,
  `note` text,
  `created_at` integer NOT NULL
);
