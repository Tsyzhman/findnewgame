import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('player'),
  isDemo: integer('is_demo').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  retentionStartedAt: integer('retention_started_at'),
  d7ReturnedAt: integer('d7_returned_at'),
});
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('UTC'),
  tasteJson: text('taste_json'),
  onboardingComplete: integer('onboarding_complete').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
export const userTagPreferences = sqliteTable(
  'user_tag_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull(),
    explicitWeight: real('explicit_weight').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tagId] })],
);
export const steamTags = sqliteTable(
  'steam_tags',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: text('category').notNull(),
    payloadJson: text('payload_json').notNull(),
    isActive: integer('is_active').notNull().default(1),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('steam_tags_slug_unique').on(t.slug)],
);
export const demoSessions = sqliteTable(
  'demo_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('demo_sessions_expiry').on(t.expiresAt)],
);
export const developers = sqliteTable(
  'developers',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    studioKey: text('studio_key').notNull(),
    lastDashboardAt: integer('last_dashboard_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('developers_studio_unique').on(t.studioKey),
    uniqueIndex('developers_owner_unique').on(t.ownerUserId),
  ],
);
export const developerMembers = sqliteTable(
  'developer_members',
  {
    developerId: text('developer_id')
      .notNull()
      .references(() => developers.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.developerId, t.userId] })],
);
export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    developerId: text('developer_id')
      .notNull()
      .references(() => developers.id),
    publisherKey: text('publisher_key').notNull(),
    familyKey: text('family_key').notNull(),
    steamAppId: integer('steam_app_id').notNull(),
    status: text('status').notNull().default('pending_review'),
    currentVersionId: text('current_version_id').notNull(),
    isDemo: integer('is_demo').notNull().default(0),
    moderationNote: text('moderation_note'),
    createdAt: integer('created_at').notNull(),
    publishedAt: integer('published_at'),
  },
  (t) => [
    uniqueIndex('games_steam_unique').on(t.steamAppId),
    index('games_owner_status').on(t.developerId, t.status),
    index('games_pool').on(t.isDemo, t.status),
  ],
);
export const gameVersions = sqliteTable(
  'game_versions',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentJson: text('content_json').notNull(),
    presentationHash: text('presentation_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('game_versions_unique').on(t.gameId, t.version)],
);
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uploads_object_key_unique').on(t.objectKey),
    uniqueIndex('uploads_owner_hash_unique').on(t.ownerUserId, t.sha256),
  ],
);
export const experiments = sqliteTable(
  'experiments',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    isRetest: integer('is_retest').notNull().default(0),
    baseVersionId: text('base_version_id')
      .notNull()
      .references(() => gameVersions.id),
    createdAt: integer('created_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [
    index('experiments_game_status').on(t.gameId, t.status),
    uniqueIndex('experiments_one_open_game')
      .on(t.gameId)
      .where(sql`${t.status} IN ('active','pending_review')`),
  ],
);
export const experimentVariants = sqliteTable(
  'experiment_variants',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    contentJson: text('content_json').notNull(),
    presentationHash: text('presentation_hash').notNull(),
  },
  (t) => [
    uniqueIndex('experiment_variants_label_unique').on(t.experimentId, t.label),
  ],
);
export const experimentAssignments = sqliteTable(
  'experiment_assignments',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    variantId: text('variant_id')
      .notNull()
      .references(() => experimentVariants.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('experiment_assignments_subject_unique').on(
      t.experimentId,
      t.userId,
    ),
  ],
);
export const dailySets = sqliteTable(
  'daily_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    timezone: text('timezone').notNull(),
    resetAt: integer('reset_at').notNull(),
    catalogMode: text('catalog_mode').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    selectionJson: text('selection_json').notNull(),
    completedAt: integer('completed_at'),
    relevance: text('relevance'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('daily_sets_user_date_unique').on(t.userId, t.localDate),
    index('daily_sets_current').on(t.userId, t.resetAt),
  ],
);
export const dailyAssignments = sqliteTable(
  'daily_assignments',
  {
    id: text('id').primaryKey(),
    setId: text('set_id')
      .notNull()
      .references(() => dailySets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    slot: integer('slot').notNull(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    developerId: text('developer_id').notNull(),
    publisherKey: text('publisher_key').notNull(),
    familyKey: text('family_key').notNull(),
    versionId: text('version_id')
      .notNull()
      .references(() => gameVersions.id),
    variantId: text('variant_id').references(() => experimentVariants.id),
    repeatExposure: integer('repeat_exposure').notNull().default(0),
    status: text('status').notNull().default('pending'),
    stage: integer('stage').notNull().default(1),
    stageOpenedAt: integer('stage_opened_at'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('daily_slot_unique').on(t.userId, t.localDate, t.slot),
    uniqueIndex('daily_developer_unique').on(
      t.userId,
      t.localDate,
      t.developerId,
    ),
    uniqueIndex('daily_publisher_unique').on(
      t.userId,
      t.localDate,
      t.publisherKey,
    ),
    uniqueIndex('daily_family_unique').on(t.userId, t.localDate, t.familyKey),
    index('daily_user_seen').on(t.userId, t.gameId),
    index('daily_set_slots').on(t.setId, t.slot),
    check('daily_slot_range', sql`${t.slot} BETWEEN 1 AND 3`),
    check('daily_stage_range', sql`${t.stage} BETWEEN 1 AND 6`),
  ],
);
export const quizStageGuesses = sqliteTable(
  'quiz_stage_guesses',
  {
    id: text('id').primaryKey(),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => dailyAssignments.id, { onDelete: 'cascade' }),
    stage: integer('stage').notNull(),
    guessJson: text('guess_json').notNull(),
    requestedMore: integer('requested_more').notNull(),
    responseTimeMs: integer('response_time_ms').notNull(),
    qualified: integer('qualified').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('quiz_stage_snapshot_unique').on(t.assignmentId, t.stage),
  ],
);
export const quizFinalResults = sqliteTable(
  'quiz_final_results',
  {
    assignmentId: text('assignment_id')
      .primaryKey()
      .references(() => dailyAssignments.id, { onDelete: 'cascade' }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    versionId: text('version_id').notNull(),
    variantId: text('variant_id'),
    score: integer('score').notNull(),
    accuracy: real('accuracy').notNull(),
    stage: integer('stage').notNull(),
    resultJson: text('result_json').notNull(),
    qualified: integer('qualified').notNull(),
    repeatExposure: integer('repeat_exposure').notNull(),
    completedAt: integer('completed_at').notNull(),
  },
  (t) => [
    index('quiz_results_game_version').on(t.gameId, t.versionId),
    index('quiz_results_user_history').on(t.userId, t.completedAt),
  ],
);
export const gameInteractions = sqliteTable(
  'game_interactions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    kind: text('kind').notNull(),
    assignmentId: text('assignment_id').references(() => dailyAssignments.id, {
      onDelete: 'set null',
    }),
    active: integer('active').notNull().default(1),
    tagIdsJson: text('tag_ids_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId, t.kind] })],
);
export const adCampaigns = sqliteTable(
  'ad_campaigns',
  {
    id: text('id').primaryKey(),
    developerId: text('developer_id')
      .notNull()
      .references(() => developers.id),
    gameId: text('game_id').references(() => games.id),
    name: text('name').notNull(),
    creativeJson: text('creative_json').notNull(),
    targetingJson: text('targeting_json').notNull(),
    status: text('status').notNull().default('pending_review'),
    moderationStatus: text('moderation_status')
      .notNull()
      .default('pending_review'),
    moderationNote: text('moderation_note'),
    paymentStatus: text('payment_status').notNull().default('unpaid'),
    requestedImpressions: integer('requested_impressions').notNull(),
    paidImpressions: integer('paid_impressions').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at').notNull(),
    isTest: integer('is_test').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('campaign_delivery_pool').on(
      t.status,
      t.moderationStatus,
      t.paymentStatus,
    ),
    index('campaign_owner').on(t.developerId),
    check(
      'ad_budget_nonnegative',
      sql`${t.paidImpressions} >= 0 AND ${t.delivered} >= 0 AND ${t.delivered} <= ${t.paidImpressions}`,
    ),
  ],
);
export const adOffers = sqliteTable(
  'ad_offers',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => adCampaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => dailyAssignments.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('ad_offer_expiry').on(t.expiresAt)],
);
export const adImpressions = sqliteTable(
  'ad_impressions',
  {
    id: text('id').primaryKey(),
    offerId: text('offer_id').notNull(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => adCampaigns.id),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    localDate: text('local_date').notNull(),
    viewableMs: integer('viewable_ms').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('ad_frequency_cap').on(t.campaignId, t.userId, t.localDate),
    uniqueIndex('ad_offer_once').on(t.offerId),
    index('ad_impressions_campaign_date').on(t.campaignId, t.createdAt),
  ],
);
export const adClicks = sqliteTable('ad_clicks', {
  impressionId: text('impression_id')
    .primaryKey()
    .references(() => adImpressions.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
});
export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    externalPaymentId: text('external_payment_id'),
    purpose: text('purpose').notNull(),
    campaignId: text('campaign_id').references(() => adCampaigns.id),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    impressions: integer('impressions').notNull().default(0),
    checkoutUrl: text('checkout_url'),
    createdAt: integer('created_at').notNull(),
    paidAt: integer('paid_at'),
    provisionedAt: integer('provisioned_at'),
  },
  (t) => [
    uniqueIndex('payments_external_unique').on(t.provider, t.externalPaymentId),
    index('payments_user').on(t.userId),
  ],
);
export const paymentWebhookEvents = sqliteTable(
  'payment_webhook_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    eventKey: text('event_key').notNull(),
    rawHash: text('raw_hash').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('webhook_event_unique').on(t.provider, t.eventKey)],
);
export const donations = sqliteTable(
  'donations',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('donation_payment_unique').on(t.paymentId)],
);
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterUserId: text('reporter_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    gameId: text('game_id').references(() => games.id),
    reason: text('reason').notNull(),
    details: text('details').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('reports_status').on(t.status)],
);
export const moderationActions = sqliteTable('moderation_actions', {
  id: text('id').primaryKey(),
  adminUserId: text('admin_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('rate_limits_expiry').on(t.expiresAt)],
);
export const siteConfig = sqliteTable('site_config', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
