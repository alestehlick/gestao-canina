CREATE TABLE `invoice_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`establishment_id` text NOT NULL,
	`account_id` text NOT NULL,
	`merged_invoice_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text,
	`reversed_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reversed_at` text,
	FOREIGN KEY (`establishment_id`) REFERENCES `establishments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `customer_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`merged_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reversed_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoice_merges_reversal_valid" CHECK((`status` = 'active' and `reversed_at` is null) or (`status` = 'reversed' and `reversed_at` is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_merges_merged_invoice_unique` ON `invoice_merges` (`merged_invoice_id`);
--> statement-breakpoint
CREATE INDEX `invoice_merges_establishment_status_idx` ON `invoice_merges` (`establishment_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `invoice_merge_members` (
	`merge_id` text NOT NULL,
	`source_invoice_id` text NOT NULL,
	`original_status` text NOT NULL,
	`original_source_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`merge_id`, `source_invoice_id`),
	FOREIGN KEY (`merge_id`) REFERENCES `invoice_merges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_merge_members_source_idx` ON `invoice_merge_members` (`source_invoice_id`);
--> statement-breakpoint
PRAGMA optimize;
