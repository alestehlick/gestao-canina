ALTER TABLE `establishments`
ADD `cash_month_start_day` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `cash_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL,
  `direction` text NOT NULL,
  `origin` text NOT NULL,
  `source_payment_id` text,
  `occurred_on` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `category` text NOT NULL,
  `description` text NOT NULL,
  `note` text,
  `status` text DEFAULT 'included' NOT NULL,
  `exclusion_reason` text,
  `created_by_user_id` text,
  `updated_by_user_id` text,
  `excluded_by_user_id` text,
  `excluded_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`source_payment_id`) REFERENCES `invoice_payments`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`excluded_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `cash_entries_amount_positive` CHECK (`cash_entries`.`amount_cents` > 0),
  CONSTRAINT `cash_entries_source_valid` CHECK (
    (`cash_entries`.`origin` = 'invoice_payment'
      and `cash_entries`.`source_payment_id` is not null
      and `cash_entries`.`direction` = 'inflow')
    or
    (`cash_entries`.`origin` = 'manual'
      and `cash_entries`.`source_payment_id` is null)
  ),
  CONSTRAINT `cash_entries_exclusion_valid` CHECK (
    (`cash_entries`.`status` = 'excluded'
      and `cash_entries`.`excluded_at` is not null)
    or
    (`cash_entries`.`status` = 'included'
      and `cash_entries`.`excluded_at` is null)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_entries_source_payment_unique`
ON `cash_entries` (`source_payment_id`);
--> statement-breakpoint
CREATE INDEX `cash_entries_establishment_date_idx`
ON `cash_entries` (`establishment_id`, `occurred_on`);
--> statement-breakpoint
CREATE INDEX `cash_entries_establishment_status_idx`
ON `cash_entries` (`establishment_id`, `status`, `occurred_on`);
--> statement-breakpoint
INSERT INTO `cash_entries` (
  `id`,
  `establishment_id`,
  `direction`,
  `origin`,
  `source_payment_id`,
  `occurred_on`,
  `amount_cents`,
  `category`,
  `description`,
  `note`,
  `status`,
  `created_by_user_id`,
  `updated_by_user_id`,
  `created_at`,
  `updated_at`
)
SELECT
  lower(hex(randomblob(16))),
  ip.`establishment_id`,
  'inflow',
  'invoice_payment',
  ip.`id`,
  substr(ip.`paid_at`, 1, 10),
  ip.`amount_cents`,
  CASE i.`source_type`
    WHEN 'credit_package' THEN 'Créditos'
    WHEN 'lodging_deposit' THEN 'Hospedagem'
    WHEN 'lodging_balance' THEN 'Hospedagem'
    ELSE 'Serviços'
  END,
  'Recebimento da fatura ' || i.`invoice_number`,
  ip.`note`,
  'included',
  ip.`recorded_by_user_id`,
  ip.`recorded_by_user_id`,
  ip.`created_at`,
  ip.`created_at`
FROM `invoice_payments` ip
INNER JOIN `invoices` i ON i.`id` = ip.`invoice_id`
WHERE NOT EXISTS (
  SELECT 1
  FROM `cash_entries` ce
  WHERE ce.`source_payment_id` = ip.`id`
);
