CREATE TABLE `account_invitations` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL,
  `normalized_email` text NOT NULL,
  `email` text NOT NULL,
  `role` text NOT NULL,
  `account_id` text,
  `token_hash` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `delivery_status` text DEFAULT 'pending' NOT NULL,
  `delivery_message_id` text,
  `delivery_error` text,
  `expires_at` text NOT NULL,
  `sent_at` text,
  `accepted_at` text,
  `accepted_user_id` text,
  `invited_by_user_id` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`accepted_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`invited_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK (`role` in ('staff', 'customer')),
  CHECK (`status` in ('pending', 'accepted', 'revoked', 'expired')),
  CHECK (`delivery_status` in ('pending', 'sent', 'failed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_invitations_token_hash_unique` ON `account_invitations` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `account_invitations_establishment_status_idx` ON `account_invitations` (`establishment_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `account_invitations_email_status_idx` ON `account_invitations` (`establishment_id`,`normalized_email`,`status`);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `expires_at` text NOT NULL,
  `used_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` in ('pending', 'used', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_status_idx` ON `password_reset_tokens` (`user_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `customer_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `establishment_id` text NOT NULL,
  `account_id` text NOT NULL,
  `requested_by_user_id` text,
  `type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `dog_id` text,
  `appointment_id` text,
  `service_catalog_id` text,
  `requested_date` text,
  `requested_end_date` text,
  `notes` text,
  `reviewed_by_user_id` text,
  `reviewed_at` text,
  `response_note` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`requested_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`service_catalog_id`) REFERENCES `service_catalog`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK (`type` in ('service', 'cancellation', 'profile_update')),
  CHECK (`status` in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `customer_requests_establishment_status_idx` ON `customer_requests` (`establishment_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `customer_requests_account_created_idx` ON `customer_requests` (`account_id`,`created_at`);
