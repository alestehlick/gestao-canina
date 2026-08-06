ALTER TABLE `invoice_payments` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversed_at` text;
--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversal_reason` text;
--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `reversed_by_user_id` text REFERENCES app_users(id) ON DELETE set null;
--> statement-breakpoint
DROP INDEX `invoice_payments_invoice_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payments_invoice_active_unique` ON `invoice_payments` (`invoice_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `invoice_payments_establishment_status_idx` ON `invoice_payments` (`establishment_id`,`status`,`paid_at`);
--> statement-breakpoint
ALTER TABLE `invoice_settlements` ADD `cancelled_by_user_id` text REFERENCES app_users(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `invoice_settlements` ADD `cancellation_reason` text;
--> statement-breakpoint
ALTER TABLE `invoice_settlements` ADD `confirmed_at` text;
--> statement-breakpoint
ALTER TABLE `invoice_settlements` ADD `confirmed_by_user_id` text REFERENCES app_users(id) ON DELETE set null;
--> statement-breakpoint
DROP INDEX `invoice_settlements_invoice_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_settlements_invoice_scheduled_unique` ON `invoice_settlements` (`invoice_id`) WHERE `status` = 'scheduled';
--> statement-breakpoint
UPDATE `appointments`
SET `status` = 'confirmed',
  `updated_at` = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE `status` IN ('in_transit', 'present', 'in_service');
--> statement-breakpoint
UPDATE `appointment_items`
SET `status` = 'confirmed',
  `updated_at` = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE `status` IN ('in_transit', 'present', 'in_service');
