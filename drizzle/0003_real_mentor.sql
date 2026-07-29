CREATE TABLE `auth_login_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`window_started_at` text NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "auth_login_rate_limits_scope_valid" CHECK("auth_login_rate_limits"."scope" in ('ip', 'ip_email')),
	CONSTRAINT "auth_login_rate_limits_attempts_positive" CHECK("auth_login_rate_limits"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE INDEX `auth_login_rate_limits_expiry_idx` ON `auth_login_rate_limits` (`expires_at`);