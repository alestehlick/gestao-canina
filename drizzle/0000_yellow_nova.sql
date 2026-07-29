CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`external_subject` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`tutor_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_external_subject_unique` ON `app_users` (`external_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_establishment_email_unique` ON `app_users` (`establishment_id`,`normalized_email`);--> statement-breakpoint
CREATE TABLE `appointment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`service_catalog_id` text NOT NULL,
	`service_name_snapshot` text NOT NULL,
	`description_snapshot` text,
	`unit_price_cents` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`details_json` text,
	`active_invoice_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "appointment_items_values_nonnegative" CHECK("appointment_items"."unit_price_cents" >= 0 and "appointment_items"."quantity" > 0 and "appointment_items"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `appointment_items_appointment_status_idx` ON `appointment_items` (`appointment_id`,`status`);--> statement-breakpoint
CREATE INDEX `appointment_items_active_invoice_idx` ON `appointment_items` (`active_invoice_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`dog_id` text NOT NULL,
	`financial_tutor_id` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`recurring_schedule_id` text,
	`occurrence_date` text,
	`internal_notes` text,
	`cancellation_reason` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`financial_tutor_id`) REFERENCES `tutors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_schedule_id`) REFERENCES `recurring_schedules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `appointments_establishment_date_status_idx` ON `appointments` (`establishment_id`,`start_date`,`status`);--> statement-breakpoint
CREATE INDEX `appointments_dog_date_idx` ON `appointments` (`dog_id`,`start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_recurrence_occurrence_unique` ON `appointments` (`recurring_schedule_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`actor_user_id` text,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`request_id` text NOT NULL,
	`reason` text,
	`result` text DEFAULT 'success' NOT NULL,
	`metadata_json` text,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `credit_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`dog_id` text,
	`service_catalog_id` text NOT NULL,
	`appointment_item_id` text,
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
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_movements_nonzero" CHECK("credit_movements"."delta_units" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_movements_idempotency_unique` ON `credit_movements` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_movements_balance_idx` ON `credit_movements` (`account_id`,`service_catalog_id`,`dog_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `customer_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`address_line` text,
	`address_city` text,
	`address_region` text DEFAULT 'SP',
	`address_postal_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `customer_accounts_establishment_name_idx` ON `customer_accounts` (`establishment_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `dog_tutors` (
	`dog_id` text NOT NULL,
	`tutor_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`emergency_contact` integer DEFAULT false NOT NULL,
	`pickup_authorized` integer DEFAULT true NOT NULL,
	`portal_visible` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`dog_id`, `tutor_id`),
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tutor_id`) REFERENCES `tutors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dog_tutors_tutor_idx` ON `dog_tutors` (`tutor_id`);--> statement-breakpoint
CREATE TABLE `dogs` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`breed` text,
	`birth_date` text,
	`sex` text DEFAULT 'unknown' NOT NULL,
	`weight_grams` integer,
	`neutered` integer,
	`photo_object_key` text,
	`feeding_notes` text,
	`temperament_notes` text,
	`health_notes` text,
	`emergency_notes` text,
	`vaccines_current` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dogs_weight_nonnegative" CHECK("dogs"."weight_grams" is null or "dogs"."weight_grams" >= 0)
);
--> statement-breakpoint
CREATE INDEX `dogs_establishment_status_name_idx` ON `dogs` (`establishment_id`,`status`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `dogs_account_idx` ON `dogs` (`account_id`);--> statement-breakpoint
CREATE TABLE `establishments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`appointment_item_id` text NOT NULL,
	`dog_name_snapshot` text NOT NULL,
	`service_name_snapshot` text NOT NULL,
	`service_date_snapshot` text NOT NULL,
	`description_snapshot` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_item_id`) REFERENCES `appointment_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_items_amount_nonnegative" CHECK("invoice_items"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_items_active_service_unique` ON `invoice_items` (`invoice_id`,`appointment_item_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`recipient_name_snapshot` text NOT NULL,
	`recipient_email_snapshot` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issued_at` text,
	`due_date` text NOT NULL,
	`total_cents` integer NOT NULL,
	`voided_at` text,
	`void_reason` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoices_total_nonnegative" CHECK("invoices"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_establishment_number_unique` ON `invoices` (`establishment_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_account_status_due_idx` ON `invoices` (`account_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`payment_id` text NOT NULL,
	`invoice_item_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`payment_id`, `invoice_item_id`),
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_item_id`) REFERENCES `invoice_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_allocations_amount_positive" CHECK("payment_allocations"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`pix_charge_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`end_to_end_id` text NOT NULL,
	`reverses_payment_id` text,
	`confirmed_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pix_charge_id`) REFERENCES `pix_charges`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_end_to_end_id_unique` ON `payments` (`end_to_end_id`);--> statement-breakpoint
CREATE INDEX `payments_invoice_confirmed_idx` ON `payments` (`invoice_id`,`confirmed_at`);--> statement-breakpoint
CREATE TABLE `pix_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`provider` text NOT NULL,
	`txid` text NOT NULL,
	`external_id` text,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`copy_paste_code` text,
	`idempotency_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pix_charges_amount_positive" CHECK("pix_charges"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pix_charges_txid_unique` ON `pix_charges` (`txid`);--> statement-breakpoint
CREATE UNIQUE INDEX `pix_charges_external_id_unique` ON `pix_charges` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pix_charges_idempotency_unique` ON `pix_charges` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `pix_charges_invoice_status_idx` ON `pix_charges` (`invoice_id`,`status`);--> statement-breakpoint
CREATE TABLE `private_files` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`visibility` text DEFAULT 'staff' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "private_files_size_nonnegative" CHECK("private_files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_files_object_key_unique` ON `private_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `private_files_owner_idx` ON `private_files` (`establishment_id`,`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `recurring_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`dog_id` text NOT NULL,
	`service_catalog_id` text NOT NULL,
	`weekdays_mask` integer NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`start_time` text,
	`end_time` text,
	`fixed_price_cents` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_schedules_weekdays_valid" CHECK("recurring_schedules"."weekdays_mask" between 1 and 127),
	CONSTRAINT "recurring_schedules_price_nonnegative" CHECK("recurring_schedules"."fixed_price_cents" is null or "recurring_schedules"."fixed_price_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `recurring_schedules_dog_status_idx` ON `recurring_schedules` (`dog_id`,`status`);--> statement-breakpoint
CREATE TABLE `service_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'service' NOT NULL,
	`base_price_cents` integer DEFAULT 0 NOT NULL,
	`duration_minutes` integer,
	`color_token` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "service_catalog_price_nonnegative" CHECK("service_catalog"."base_price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_catalog_establishment_code_unique` ON `service_catalog` (`establishment_id`,`code`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`dog_id` text,
	`account_id` text,
	`appointment_id` text,
	`title` text NOT NULL,
	`description` text,
	`scheduled_date` text,
	`scheduled_time` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_user_id` text,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_establishment_date_status_idx` ON `tasks` (`establishment_id`,`scheduled_date`,`status`);--> statement-breakpoint
CREATE TABLE `tutors` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`full_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`email` text,
	`normalized_email` text,
	`phone_e164` text,
	`whatsapp_enabled` integer DEFAULT true NOT NULL,
	`is_financial_contact` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `tutors_account_name_idx` ON `tutors` (`account_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `tutors_email_idx` ON `tutors` (`establishment_id`,`normalized_email`);--> statement-breakpoint
CREATE INDEX `tutors_phone_idx` ON `tutors` (`establishment_id`,`phone_e164`);