CREATE TABLE `credit_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`service_catalog_id` text NOT NULL,
	`name` text NOT NULL,
	`credit_units` integer NOT NULL,
	`package_price_cents` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_packages_units_positive" CHECK("credit_packages"."credit_units" > 0),
	CONSTRAINT "credit_packages_price_positive" CHECK("credit_packages"."package_price_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_packages_establishment_active_idx` ON `credit_packages` (`establishment_id`,`active`);--> statement-breakpoint
CREATE INDEX `credit_packages_service_idx` ON `credit_packages` (`service_catalog_id`);--> statement-breakpoint
CREATE TABLE `credit_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`package_id` text,
	`service_catalog_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`package_name_snapshot` text NOT NULL,
	`credit_units` integer NOT NULL,
	`standard_value_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'awaiting_payment' NOT NULL,
	`grant_movement_id` text,
	`created_by_user_id` text,
	`paid_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`) REFERENCES `credit_packages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_purchases_units_positive" CHECK("credit_purchases"."credit_units" > 0),
	CONSTRAINT "credit_purchases_values_positive" CHECK("credit_purchases"."standard_value_cents" > 0 and "credit_purchases"."amount_cents" > 0),
	CONSTRAINT "credit_purchases_grant_valid" CHECK(("credit_purchases"."status" = 'paid' and "credit_purchases"."grant_movement_id" is not null and "credit_purchases"."paid_at" is not null) or ("credit_purchases"."status" <> 'paid' and "credit_purchases"."grant_movement_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_purchases_invoice_unique` ON `credit_purchases` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_purchases_grant_movement_unique` ON `credit_purchases` (`grant_movement_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_account_status_idx` ON `credit_purchases` (`account_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_purchases_service_idx` ON `credit_purchases` (`service_catalog_id`);--> statement-breakpoint
CREATE TABLE `__new_credit_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`dog_id` text,
	`service_catalog_id` text NOT NULL,
	`appointment_item_id` text,
	`credit_purchase_id` text,
	`reversed_movement_id` text,
	`movement_type` text NOT NULL,
	`delta_units` integer NOT NULL,
	`reason` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`actor_user_id` text,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_item_id`) REFERENCES `appointment_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`credit_purchase_id`) REFERENCES `credit_purchases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_movements_nonzero" CHECK("__new_credit_movements"."delta_units" <> 0),
	CONSTRAINT "credit_movements_sign_valid" CHECK(("__new_credit_movements"."movement_type" in ('grant', 'refund') and "__new_credit_movements"."delta_units" > 0) or ("__new_credit_movements"."movement_type" = 'consume' and "__new_credit_movements"."delta_units" < 0) or "__new_credit_movements"."movement_type" = 'adjust')
);
--> statement-breakpoint
INSERT INTO `__new_credit_movements`("id", "establishment_id", "account_id", "dog_id", "service_catalog_id", "appointment_item_id", "credit_purchase_id", "reversed_movement_id", "movement_type", "delta_units", "reason", "idempotency_key", "actor_user_id", "occurred_at")
SELECT "id", "establishment_id", "account_id", "dog_id", "service_catalog_id", "appointment_item_id", NULL, "reversed_movement_id", "movement_type", "delta_units", "reason", "idempotency_key", "actor_user_id", "occurred_at"
FROM `credit_movements`;--> statement-breakpoint
DROP TABLE `credit_movements`;--> statement-breakpoint
ALTER TABLE `__new_credit_movements` RENAME TO `credit_movements`;--> statement-breakpoint
CREATE UNIQUE INDEX `credit_movements_idempotency_unique` ON `credit_movements` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_movements_purchase_grant_unique` ON `credit_movements` (`credit_purchase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_movements_item_consume_unique` ON `credit_movements` (`appointment_item_id`);--> statement-breakpoint
CREATE INDEX `credit_movements_balance_idx` ON `credit_movements` (`account_id`,`service_catalog_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `appointment_items` ADD `payment_preference` text DEFAULT 'pix' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointment_items` ADD `settlement_method` text DEFAULT 'unsettled' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointment_items` ADD `credit_movement_id` text;--> statement-breakpoint
ALTER TABLE `appointment_items` ADD `settled_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_items_credit_movement_unique` ON `appointment_items` (`credit_movement_id`);--> statement-breakpoint
CREATE INDEX `appointment_items_settlement_idx` ON `appointment_items` (`settlement_method`);--> statement-breakpoint
CREATE TRIGGER `appointment_items_credit_settlement_insert`
BEFORE INSERT ON `appointment_items`
WHEN NOT (
	(NEW.`settlement_method` = 'credit' AND NEW.`credit_movement_id` IS NOT NULL AND NEW.`settled_at` IS NOT NULL)
	OR
	(NEW.`settlement_method` <> 'credit' AND NEW.`credit_movement_id` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid credit settlement');
END;--> statement-breakpoint
CREATE TRIGGER `appointment_items_credit_settlement_update`
BEFORE UPDATE OF `settlement_method`, `credit_movement_id`, `settled_at` ON `appointment_items`
WHEN NOT (
	(NEW.`settlement_method` = 'credit' AND NEW.`credit_movement_id` IS NOT NULL AND NEW.`settled_at` IS NOT NULL)
	OR
	(NEW.`settlement_method` <> 'credit' AND NEW.`credit_movement_id` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid credit settlement');
END;--> statement-breakpoint
ALTER TABLE `invoices` ADD `source_type` text DEFAULT 'services' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `source_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_establishment_source_unique` ON `invoices` (`establishment_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TRIGGER `invoices_credit_package_source_insert`
BEFORE INSERT ON `invoices`
WHEN NEW.`source_type` = 'credit_package' AND NEW.`source_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'credit package invoice requires source');
END;--> statement-breakpoint
CREATE TRIGGER `invoices_credit_package_source_update`
BEFORE UPDATE OF `source_type`, `source_id` ON `invoices`
WHEN NEW.`source_type` = 'credit_package' AND NEW.`source_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'credit package invoice requires source');
END;--> statement-breakpoint
CREATE TABLE `credit_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`dog_id` text,
	`appointment_item_id` text NOT NULL,
	`credit_movement_id` text NOT NULL,
	`receipt_number` text NOT NULL,
	`customer_name_snapshot` text NOT NULL,
	`dog_name_snapshot` text NOT NULL,
	`service_name_snapshot` text NOT NULL,
	`service_date_snapshot` text NOT NULL,
	`credit_units` integer DEFAULT 1 NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivery_channels_json` text NOT NULL,
	`issued_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appointment_item_id`) REFERENCES `appointment_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`credit_movement_id`) REFERENCES `credit_movements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "credit_receipts_units_positive" CHECK("credit_receipts"."credit_units" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_receipts_establishment_number_unique` ON `credit_receipts` (`establishment_id`,`receipt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_receipts_item_unique` ON `credit_receipts` (`appointment_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_receipts_movement_unique` ON `credit_receipts` (`credit_movement_id`);--> statement-breakpoint
CREATE INDEX `credit_receipts_account_date_idx` ON `credit_receipts` (`account_id`,`issued_at`);
