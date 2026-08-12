ALTER TABLE `financial_accounts` ADD `opening_balance_cents` integer;
ALTER TABLE `financial_accounts` ADD `opening_balance_on` text;
ALTER TABLE `financial_accounts` ADD `reconciled_balance_cents` integer;
ALTER TABLE `financial_accounts` ADD `reconciled_on` text;
ALTER TABLE `financial_accounts` ADD `reconciled_at` text;
ALTER TABLE `financial_accounts` ADD `reconciled_by_user_id` text REFERENCES app_users(id);

CREATE TABLE `cash_transfers` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL REFERENCES establishments(id) ON DELETE restrict,
  `from_financial_account_id` text NOT NULL REFERENCES financial_accounts(id) ON DELETE restrict,
  `to_financial_account_id` text NOT NULL REFERENCES financial_accounts(id) ON DELETE restrict,
  `occurred_on` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `description` text NOT NULL,
  `note` text,
  `status` text DEFAULT 'included' NOT NULL,
  `idempotency_key` text NOT NULL,
  `exclusion_reason` text,
  `created_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `excluded_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `excluded_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  CONSTRAINT `cash_transfers_amount_positive` CHECK (`amount_cents` > 0),
  CONSTRAINT `cash_transfers_accounts_distinct` CHECK (`from_financial_account_id` <> `to_financial_account_id`)
);
CREATE UNIQUE INDEX `cash_transfers_establishment_idempotency_unique`
  ON `cash_transfers` (`establishment_id`, `idempotency_key`);
CREATE INDEX `cash_transfers_establishment_date_idx`
  ON `cash_transfers` (`establishment_id`, `occurred_on`);

CREATE TABLE `cash_reconciliations` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL REFERENCES establishments(id) ON DELETE restrict,
  `financial_account_id` text NOT NULL REFERENCES financial_accounts(id) ON DELETE restrict,
  `reconciled_on` text NOT NULL,
  `statement_balance_cents` integer NOT NULL,
  `system_balance_cents` integer NOT NULL,
  `difference_cents` integer NOT NULL,
  `note` text,
  `created_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
CREATE INDEX `cash_reconciliations_account_date_idx`
  ON `cash_reconciliations` (`financial_account_id`, `reconciled_on`, `created_at`);

CREATE TABLE `cash_periods` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL REFERENCES establishments(id) ON DELETE restrict,
  `period_start` text NOT NULL,
  `period_end` text NOT NULL,
  `status` text DEFAULT 'closed' NOT NULL,
  `close_note` text,
  `closed_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `closed_at` text,
  `reopened_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `reopened_at` text,
  `reopen_reason` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `version` integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX `cash_periods_establishment_range_unique`
  ON `cash_periods` (`establishment_id`, `period_start`, `period_end`);
CREATE INDEX `cash_periods_establishment_status_idx`
  ON `cash_periods` (`establishment_id`, `status`, `period_start`, `period_end`);

ALTER TABLE `cash_entries` ADD `transfer_id` text REFERENCES cash_transfers(id);
ALTER TABLE `cash_entries` ADD `idempotency_key` text;
ALTER TABLE `cash_entries` ADD `version` integer DEFAULT 1 NOT NULL;
CREATE UNIQUE INDEX `cash_entries_establishment_idempotency_unique`
  ON `cash_entries` (`establishment_id`, `idempotency_key`);
CREATE INDEX `cash_entries_transfer_idx` ON `cash_entries` (`transfer_id`);

PRAGMA optimize;
