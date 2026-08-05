CREATE INDEX `audit_events_establishment_date_idx`
ON `audit_events` (`establishment_id`, `occurred_at`);
--> statement-breakpoint
PRAGMA optimize;
