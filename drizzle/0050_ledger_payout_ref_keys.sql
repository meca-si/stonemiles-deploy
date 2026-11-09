-- Vesting/queue payout hardening: an idempotency key on the two pool
-- ledgers. A payout row for a given source record (welcome credit,
-- vesting tranche, referral reward, giveaway tranche) can be recorded
-- exactly once — the UNIQUE index is the hard guard that makes a
-- double-run or concurrent run of a payout processor unable to
-- double-pay. Existing rows keep NULL (SQLite unique indexes admit
-- any number of NULLs).
ALTER TABLE `earning_pool_ledger` ADD COLUMN `ref_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `earning_pool_ledger_ref_key_unique` ON `earning_pool_ledger` (`ref_key`);
--> statement-breakpoint
ALTER TABLE `reward_wallet_ledger` ADD COLUMN `ref_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_wallet_ledger_ref_key_unique` ON `reward_wallet_ledger` (`ref_key`);
