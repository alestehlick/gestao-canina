CREATE TABLE `invoice_settlements` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `available_on` text NOT NULL,
  `note` text,
  `status` text DEFAULT 'scheduled' NOT NULL,
  `created_by_user_id` text,
  `cancelled_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `invoice_settlements_amount_positive` CHECK (`amount_cents` > 0),
  CONSTRAINT `invoice_settlements_cancelled_valid` CHECK ((`status` = 'cancelled' and `cancelled_at` is not null) or (`status` = 'scheduled' and `cancelled_at` is null))
);

CREATE UNIQUE INDEX `invoice_settlements_invoice_unique`
ON `invoice_settlements` (`invoice_id`);

CREATE INDEX `invoice_settlements_establishment_available_idx`
ON `invoice_settlements` (`establishment_id`, `status`, `available_on`);

INSERT OR IGNORE INTO `invoice_settlements` (
  `id`, `establishment_id`, `invoice_id`, `amount_cents`, `available_on`,
  `note`, `status`, `created_by_user_id`, `created_at`, `updated_at`
)
SELECT
  lower(hex(randomblob(16))), ip.`establishment_id`, ip.`invoice_id`,
  ip.`amount_cents`, substr(ip.`paid_at`, 1, 10),
  'Pagamento registrado antes do fluxo de compensação', 'scheduled',
  ip.`recorded_by_user_id`, ip.`created_at`, ip.`created_at`
FROM `invoice_payments` ip
INNER JOIN `invoices` i ON i.`id` = ip.`invoice_id`
WHERE i.`invoice_number` = 'FAT-20260805-9F334F'
  AND i.`status` = 'paid';

DELETE FROM `cash_entries`
WHERE `source_payment_id` IN (
  SELECT ip.`id`
  FROM `invoice_payments` ip
  INNER JOIN `invoices` i ON i.`id` = ip.`invoice_id`
  WHERE i.`invoice_number` = 'FAT-20260805-9F334F'
    AND i.`status` = 'paid'
);

UPDATE `appointment_items`
SET `settlement_method` = 'unsettled', `settled_at` = NULL,
  `updated_at` = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE `settlement_method` = 'invoice'
  AND `id` IN (
    SELECT ii.`appointment_item_id`
    FROM `invoice_items` ii
    INNER JOIN `invoices` i ON i.`id` = ii.`invoice_id`
    WHERE i.`invoice_number` = 'FAT-20260805-9F334F'
      AND i.`status` = 'paid'
      AND ii.`service_name_snapshot` <> 'Sinal da hospedagem'
  );

DELETE FROM `invoice_payments`
WHERE `invoice_id` IN (
  SELECT `id` FROM `invoices`
  WHERE `invoice_number` = 'FAT-20260805-9F334F' AND `status` = 'paid'
);

UPDATE `invoices`
SET `status` = 'issued', `updated_at` = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE `invoice_number` = 'FAT-20260805-9F334F' AND `status` = 'paid';
