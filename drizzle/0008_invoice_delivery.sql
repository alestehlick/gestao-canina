ALTER TABLE `invoices` ADD `delivery_channels_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `last_sent_at` text;
