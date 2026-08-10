CREATE TABLE `financial_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`kind` text DEFAULT 'checking' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `financial_accounts_establishment_active_idx` ON `financial_accounts` (`establishment_id`,`active`,`display_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_accounts_establishment_name_unique` ON `financial_accounts` (`establishment_id`,`name`);
--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `financial_account_id` text REFERENCES financial_accounts(id);
--> statement-breakpoint
ALTER TABLE `invoice_settlements` ADD `financial_account_id` text REFERENCES financial_accounts(id);
--> statement-breakpoint
ALTER TABLE `cash_entries` ADD `financial_account_id` text REFERENCES financial_accounts(id);
--> statement-breakpoint
CREATE INDEX `invoice_payments_financial_account_idx` ON `invoice_payments` (`financial_account_id`,`paid_at`);
--> statement-breakpoint
CREATE INDEX `invoice_settlements_financial_account_idx` ON `invoice_settlements` (`financial_account_id`,`available_on`);
--> statement-breakpoint
CREATE INDEX `cash_entries_financial_account_idx` ON `cash_entries` (`financial_account_id`,`occurred_on`);
--> statement-breakpoint
INSERT INTO `financial_accounts` (`id`, `establishment_id`, `name`, `institution`, `kind`, `active`, `display_order`)
SELECT 'financial-main-' || `id`, `id`, 'Conta principal', NULL, 'checking', 1, 0
FROM `establishments`
WHERE NOT EXISTS (
	SELECT 1 FROM `financial_accounts` fa WHERE fa.`establishment_id` = `establishments`.`id`
);
--> statement-breakpoint
UPDATE `invoice_payments`
SET `financial_account_id` = (
	SELECT fa.`id` FROM `financial_accounts` fa
	WHERE fa.`establishment_id` = `invoice_payments`.`establishment_id`
	ORDER BY fa.`display_order`, fa.`created_at`
	LIMIT 1
)
WHERE `financial_account_id` IS NULL;
--> statement-breakpoint
UPDATE `invoice_settlements`
SET `financial_account_id` = (
	SELECT fa.`id` FROM `financial_accounts` fa
	WHERE fa.`establishment_id` = `invoice_settlements`.`establishment_id`
	ORDER BY fa.`display_order`, fa.`created_at`
	LIMIT 1
)
WHERE `financial_account_id` IS NULL;
--> statement-breakpoint
UPDATE `cash_entries`
SET `financial_account_id` = (
	SELECT fa.`id` FROM `financial_accounts` fa
	WHERE fa.`establishment_id` = `cash_entries`.`establishment_id`
	ORDER BY fa.`display_order`, fa.`created_at`
	LIMIT 1
)
WHERE `financial_account_id` IS NULL;
--> statement-breakpoint
PRAGMA optimize;
