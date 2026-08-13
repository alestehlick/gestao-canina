DROP TABLE IF EXISTS `__new_invoice_settlements`;

CREATE TABLE `__new_invoice_settlements` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL REFERENCES establishments(id) ON DELETE restrict,
  `invoice_id` text NOT NULL REFERENCES invoices(id) ON DELETE restrict,
  `financial_account_id` text REFERENCES financial_accounts(id) ON DELETE restrict,
  `amount_cents` integer NOT NULL,
  `available_on` text NOT NULL,
  `note` text,
  `status` text DEFAULT 'scheduled' NOT NULL,
  `created_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `cancelled_at` text,
  `cancelled_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `cancellation_reason` text,
  `confirmed_at` text,
  `confirmed_by_user_id` text REFERENCES app_users(id) ON DELETE set null,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  CONSTRAINT `invoice_settlements_amount_positive`
    CHECK (`amount_cents` > 0),
  CONSTRAINT `invoice_settlements_state_valid`
    CHECK (
      (`status` = 'scheduled'
        AND `cancelled_at` IS NULL
        AND `confirmed_at` IS NULL)
      OR
      (`status` = 'confirmed'
        AND `confirmed_at` IS NOT NULL
        AND `cancelled_at` IS NULL)
      OR
      (`status` = 'cancelled'
        AND `cancelled_at` IS NOT NULL
        AND `cancellation_reason` IS NOT NULL
        AND `confirmed_at` IS NULL)
    )
);

INSERT INTO `__new_invoice_settlements` (
  `id`, `establishment_id`, `invoice_id`, `financial_account_id`,
  `amount_cents`, `available_on`, `note`, `status`,
  `created_by_user_id`, `cancelled_at`, `cancelled_by_user_id`,
  `cancellation_reason`,
  `confirmed_at`, `confirmed_by_user_id`,
  `created_at`, `updated_at`
)
SELECT
  `id`, `establishment_id`, `invoice_id`, `financial_account_id`,
  `amount_cents`, `available_on`, `note`, `status`,
  `created_by_user_id`, `cancelled_at`, `cancelled_by_user_id`,
  CASE
    WHEN `status` = 'cancelled' THEN
      COALESCE(NULLIF(trim(`cancellation_reason`), ''), 'Cancelamento registrado anteriormente')
    ELSE `cancellation_reason`
  END,
  `confirmed_at`, `confirmed_by_user_id`,
  `created_at`, `updated_at`
FROM `invoice_settlements`;

DROP TABLE `invoice_settlements`;
ALTER TABLE `__new_invoice_settlements` RENAME TO `invoice_settlements`;

CREATE UNIQUE INDEX `invoice_settlements_invoice_scheduled_unique`
  ON `invoice_settlements` (`invoice_id`)
  WHERE `status` = 'scheduled';
CREATE INDEX `invoice_settlements_establishment_available_idx`
  ON `invoice_settlements` (`establishment_id`, `status`, `available_on`);
CREATE INDEX `invoice_settlements_financial_account_idx`
  ON `invoice_settlements` (`financial_account_id`, `available_on`);

PRAGMA optimize;
