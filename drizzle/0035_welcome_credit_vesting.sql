CREATE TABLE `welcome_vesting` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `welcome_credit_id` integer NOT NULL REFERENCES `welcome_credits`(`id`),
  `plan` text NOT NULL,
  `tranche_no` integer NOT NULL,
  `total_tranches` integer NOT NULL,
  `amount_stoner` real NOT NULL,
  `due_at` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `paid_at` integer,
  `note` text,
  `created_at` integer NOT NULL
);
