CREATE TABLE `ad_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`developer_id` text NOT NULL,
	`game_id` text,
	`name` text NOT NULL,
	`creative_json` text NOT NULL,
	`targeting_json` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`moderation_status` text DEFAULT 'pending_review' NOT NULL,
	`moderation_note` text,
	`payment_status` text DEFAULT 'unpaid' NOT NULL,
	`requested_impressions` integer NOT NULL,
	`paid_impressions` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`is_test` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`developer_id`) REFERENCES `developers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ad_budget_nonnegative" CHECK("ad_campaigns"."paid_impressions" >= 0 AND "ad_campaigns"."delivered" >= 0 AND "ad_campaigns"."delivered" <= "ad_campaigns"."paid_impressions")
);
--> statement-breakpoint
CREATE INDEX `campaign_delivery_pool` ON `ad_campaigns` (`status`,`moderation_status`,`payment_status`);--> statement-breakpoint
CREATE INDEX `campaign_owner` ON `ad_campaigns` (`developer_id`);--> statement-breakpoint
CREATE TABLE `ad_clicks` (
	`impression_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`impression_id`) REFERENCES `ad_impressions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ad_impressions` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text,
	`local_date` text NOT NULL,
	`viewable_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `ad_campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_frequency_cap` ON `ad_impressions` (`campaign_id`,`user_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `ad_offer_once` ON `ad_impressions` (`offer_id`);--> statement-breakpoint
CREATE INDEX `ad_impressions_campaign_date` ON `ad_impressions` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ad_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`local_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `ad_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `daily_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ad_offer_expiry` ON `ad_offers` (`expires_at`);--> statement-breakpoint
CREATE TABLE `daily_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`slot` integer NOT NULL,
	`game_id` text NOT NULL,
	`developer_id` text NOT NULL,
	`publisher_key` text NOT NULL,
	`family_key` text NOT NULL,
	`version_id` text NOT NULL,
	`variant_id` text,
	`repeat_exposure` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stage` integer DEFAULT 1 NOT NULL,
	`stage_opened_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `daily_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `game_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "daily_slot_range" CHECK("daily_assignments"."slot" BETWEEN 1 AND 3),
	CONSTRAINT "daily_stage_range" CHECK("daily_assignments"."stage" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_slot_unique` ON `daily_assignments` (`user_id`,`local_date`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_developer_unique` ON `daily_assignments` (`user_id`,`local_date`,`developer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_publisher_unique` ON `daily_assignments` (`user_id`,`local_date`,`publisher_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_family_unique` ON `daily_assignments` (`user_id`,`local_date`,`family_key`);--> statement-breakpoint
CREATE INDEX `daily_user_seen` ON `daily_assignments` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `daily_set_slots` ON `daily_assignments` (`set_id`,`slot`);--> statement-breakpoint
CREATE TABLE `daily_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`reset_at` integer NOT NULL,
	`catalog_mode` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`selection_json` text NOT NULL,
	`completed_at` integer,
	`relevance` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_sets_user_date_unique` ON `daily_sets` (`user_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `daily_sets_current` ON `daily_sets` (`user_id`,`reset_at`);--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `demo_sessions_expiry` ON `demo_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `developer_members` (
	`developer_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`developer_id`, `user_id`),
	FOREIGN KEY (`developer_id`) REFERENCES `developers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `developers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`name` text NOT NULL,
	`studio_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developers_studio_unique` ON `developers` (`studio_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `developers_owner_unique` ON `developers` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `donations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`user_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `donation_payment_unique` ON `donations` (`payment_id`);--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_assignments_subject_unique` ON `experiment_assignments` (`experiment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `experiment_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`label` text NOT NULL,
	`content_json` text NOT NULL,
	`presentation_hash` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_variants_label_unique` ON `experiment_variants` (`experiment_id`,`label`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_retest` integer DEFAULT 0 NOT NULL,
	`base_version_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `game_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `experiments_game_status` ON `experiments` (`game_id`,`status`);--> statement-breakpoint
CREATE TABLE `game_interactions` (
	`user_id` text NOT NULL,
	`game_id` text NOT NULL,
	`kind` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`tag_ids_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `game_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`presentation_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_versions_unique` ON `game_versions` (`game_id`,`version`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`developer_id` text NOT NULL,
	`publisher_key` text NOT NULL,
	`family_key` text NOT NULL,
	`steam_app_id` integer NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`current_version_id` text NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`moderation_note` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`developer_id`) REFERENCES `developers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_steam_unique` ON `games` (`steam_app_id`);--> statement-breakpoint
CREATE INDEX `games_owner_status` ON `games` (`developer_id`,`status`);--> statement-breakpoint
CREATE INDEX `games_pool` ON `games` (`is_demo`,`status`);--> statement-breakpoint
CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `payment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_key` text NOT NULL,
	`raw_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_unique` ON `payment_webhook_events` (`provider`,`event_key`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`external_payment_id` text,
	`purpose` text NOT NULL,
	`campaign_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`checkout_url` text,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`provisioned_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `ad_campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_external_unique` ON `payments` (`provider`,`external_payment_id`);--> statement-breakpoint
CREATE INDEX `payments_user` ON `payments` (`user_id`);--> statement-breakpoint
CREATE TABLE `quiz_final_results` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version_id` text NOT NULL,
	`variant_id` text,
	`score` integer NOT NULL,
	`accuracy` real NOT NULL,
	`stage` integer NOT NULL,
	`result_json` text NOT NULL,
	`qualified` integer NOT NULL,
	`repeat_exposure` integer NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `daily_assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_results_game_version` ON `quiz_final_results` (`game_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `quiz_results_user_history` ON `quiz_final_results` (`user_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `quiz_stage_guesses` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`stage` integer NOT NULL,
	`guess_json` text NOT NULL,
	`requested_more` integer NOT NULL,
	`response_time_ms` integer NOT NULL,
	`qualified` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `daily_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_stage_snapshot_unique` ON `quiz_stage_guesses` (`assignment_id`,`stage`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expiry` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`game_id` text,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_status` ON `reports` (`status`);--> statement-breakpoint
CREATE TABLE `site_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steam_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`category` text NOT NULL,
	`payload_json` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `steam_tags_slug_unique` ON `steam_tags` (`slug`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_object_key_unique` ON `uploads` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_owner_hash_unique` ON `uploads` (`owner_user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`taste_json` text,
	`onboarding_complete` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_tag_preferences` (
	`user_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`explicit_weight` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `tag_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL
);
