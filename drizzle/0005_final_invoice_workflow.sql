ALTER TABLE `establishments` ADD `daycare_start_time` text NOT NULL DEFAULT '07:30';
ALTER TABLE `establishments` ADD `daycare_end_time` text NOT NULL DEFAULT '19:30';

UPDATE `appointment_items`
SET `payment_preference` = 'invoice'
WHERE `payment_preference` = 'pix';

UPDATE `appointment_items`
SET `settlement_method` = 'invoice'
WHERE `settlement_method` = 'pix';

UPDATE `invoices`
SET `invoice_number` = replace(`invoice_number`, 'PIX-', 'FAT-')
WHERE `invoice_number` LIKE 'PIX-%';

UPDATE `service_catalog`
SET `code` = 'bath_grooming', `name` = 'Banho e tosa'
WHERE `code` = 'hygienic_grooming';

UPDATE `service_catalog`
SET `code` = 'taxi_dog', `name` = 'Taxi-dog'
WHERE `code` = 'transport';

CREATE TABLE `invoice_payments` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `method` text DEFAULT 'manual' NOT NULL,
  `note` text,
  `paid_at` text NOT NULL,
  `recorded_by_user_id` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`recorded_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `invoice_payments_amount_positive` CHECK (`invoice_payments`.`amount_cents` > 0)
);

CREATE UNIQUE INDEX `invoice_payments_invoice_unique`
ON `invoice_payments` (`invoice_id`);

CREATE INDEX `invoice_payments_invoice_paid_idx`
ON `invoice_payments` (`invoice_id`, `paid_at`);

INSERT OR IGNORE INTO `invoice_payments` (
  `id`, `establishment_id`, `invoice_id`, `amount_cents`, `method`,
  `note`, `paid_at`, `recorded_by_user_id`, `created_at`
)
SELECT
  `id`, `establishment_id`, `invoice_id`, `amount_cents`, 'manual',
  'Pagamento confirmado antes da atualização do faturamento',
  `confirmed_at`, NULL, `created_at`
FROM `payments`
WHERE `kind` = 'charge';

DROP TABLE IF EXISTS `payment_allocations`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `pix_charges`;
