import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Synthetic data only. This module is used by the isolated recovery drill,
// never by the application, a real merchant, or the deployed Site.
export async function seedRecoveryFixture(env, root) {
  const db = env.DB;
  const now = 1788177600000;
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    if (![table, ...columns].every((value) => /^[a-z_][a-z0-9_]*$/.test(value)))
      throw new Error('Invalid fixture identifier.');
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      .bind(...Object.values(row))
      .run();
  };
  const tags = JSON.parse(
    await readFile(join(root, 'data/steam_tags.json'), 'utf8'),
  ).slice(0, 3);
  const tagIds = tags.map((tag) => tag.id);
  for (const tag of tags)
    await insert('steam_tags', {
      id: tag.id,
      name: tag.steam_name,
      slug: tag.slug,
      category: tag.category,
      payload_json: JSON.stringify(tag),
      is_active: 1,
      updated_at: now,
    });
  for (const id of ['player', 'owner', 'admin'])
    await insert('users', {
      id: `fixture-${id}`,
      email: `${id}@example.test`,
      display_name: `Recovery ${id}'s "quoted"\nname`,
      role: id === 'admin' ? 'admin' : 'player',
      is_demo: 1,
      created_at: now,
      last_active_at: now,
      retention_started_at: null,
      d7_returned_at: null,
    });
  const taste = JSON.stringify({
    genres: tagIds,
    mechanics: [],
    moods: [],
    hardNo: [],
    discoveryMode: 'balanced',
  });
  await insert('user_profiles', {
    user_id: 'fixture-player',
    timezone: 'America/New_York',
    taste_json: taste,
    onboarding_complete: 1,
    updated_at: now,
  });
  await insert('user_tag_preferences', {
    user_id: 'fixture-player',
    tag_id: tagIds[0],
    explicit_weight: 0.7,
    updated_at: now,
  });
  await insert('demo_sessions', {
    token_hash: hash('synthetic-recovery-session'),
    user_id: 'fixture-player',
    expires_at: now + 86400000,
  });
  const bytes = await readFile(join(root, 'public/og.png'));
  const key = `images/fixture/${hash(bytes)}.png`;
  await env.FILES.put(key, bytes, {
    httpMetadata: {
      contentType: 'image/png',
      cacheControl: 'private, no-store',
    },
    customMetadata: { purpose: 'synthetic recovery fixture' },
  });
  await insert('uploads', {
    id: 'fixture-upload',
    owner_user_id: 'fixture-owner',
    object_key: key,
    sha256: hash(bytes),
    content_type: 'image/png',
    size: bytes.length,
    created_at: now,
  });
  const samples = JSON.parse(
    await readFile(join(root, 'data/demo_games.json'), 'utf8'),
  ).slice(0, 3);
  const contents = [];
  for (const [index, sample] of samples.entries()) {
    const content = {
      ...sample,
      title: `Recovery fixture ${index}`,
      capsule: `r2:${key}`,
    };
    contents.push(content);
    await insert('developers', {
      id: `fixture-studio-${index}`,
      owner_user_id: index ? null : 'fixture-owner',
      name: `Recovery studio ${index}`,
      studio_key: `recoverystudio${index}`,
      created_at: now,
      last_dashboard_at: now,
    });
    await insert('games', {
      id: `fixture-game-${index}`,
      developer_id: `fixture-studio-${index}`,
      publisher_key: `publisher-${index}`,
      family_key: `family-${index}`,
      steam_app_id: 2000000000 + index,
      status: 'published',
      current_version_id: `fixture-version-${index}`,
      is_demo: 1,
      created_at: now,
      published_at: now,
    });
    await insert('game_versions', {
      id: `fixture-version-${index}`,
      game_id: `fixture-game-${index}`,
      version: 1,
      content_json: JSON.stringify(content),
      presentation_hash: hash(JSON.stringify(content)),
      created_at: now,
    });
  }
  await insert('developer_members', {
    developer_id: 'fixture-studio-0',
    user_id: 'fixture-player',
  });
  await insert('experiments', {
    id: 'fixture-experiment',
    game_id: 'fixture-game-0',
    name: 'Synthetic artwork comparison',
    kind: 'capsule',
    status: 'ended',
    is_retest: 0,
    base_version_id: 'fixture-version-0',
    created_at: now,
    ended_at: now + 1000,
  });
  for (const label of ['A', 'B'])
    await insert('experiment_variants', {
      id: `fixture-variant-${label}`,
      experiment_id: 'fixture-experiment',
      label,
      content_json: JSON.stringify(contents[0]),
      presentation_hash: hash(JSON.stringify(contents[0])),
    });
  await insert('experiment_assignments', {
    id: 'fixture-experiment-assignment',
    experiment_id: 'fixture-experiment',
    user_id: 'fixture-player',
    variant_id: 'fixture-variant-B',
    created_at: now,
  });
  await insert('daily_sets', {
    id: 'fixture-set',
    user_id: 'fixture-player',
    local_date: '2026-08-31',
    timezone: 'America/New_York',
    reset_at: now + 86400000,
    catalog_mode: 'demo',
    algorithm_version: 'taste-random-v1.1',
    selection_json: JSON.stringify({
      mode: 'balanced',
      meanPairwiseSimilarity: 0.25,
      note: 'Immutable synthetic recovery decision',
    }),
    completed_at: now + 5000,
    relevance: 'yes',
    created_at: now,
  });
  for (let index = 0; index < 3; index++) {
    await insert('daily_assignments', {
      id: `fixture-round-${index}`,
      set_id: 'fixture-set',
      user_id: 'fixture-player',
      local_date: '2026-08-31',
      slot: index + 1,
      game_id: `fixture-game-${index}`,
      developer_id: `fixture-studio-${index}`,
      publisher_key: `publisher-${index}`,
      family_key: `family-${index}`,
      version_id: `fixture-version-${index}`,
      variant_id: index ? null : 'fixture-variant-B',
      repeat_exposure: 0,
      status: 'complete',
      stage: 1,
      stage_opened_at: now,
      started_at: now,
      completed_at: now + 5000,
      created_at: now,
    });
    await insert('quiz_stage_guesses', {
      id: `fixture-guess-${index}`,
      assignment_id: `fixture-round-${index}`,
      stage: 1,
      guess_json: JSON.stringify({
        genre: tagIds.slice(0, 1),
        core: [],
        mood: [],
        wouldClick: 'no',
      }),
      requested_more: 0,
      response_time_ms: 5000,
      qualified: 0,
      created_at: now + 5000,
    });
    await insert('quiz_final_results', {
      assignment_id: `fixture-round-${index}`,
      game_id: `fixture-game-${index}`,
      user_id: 'fixture-player',
      version_id: `fixture-version-${index}`,
      variant_id: index ? null : 'fixture-variant-B',
      score: 0,
      accuracy: 0,
      stage: 1,
      result_json: JSON.stringify({ correct: [], missed: tagIds, wrong: [] }),
      qualified: 0,
      repeat_exposure: 0,
      completed_at: now + 5000,
    });
  }
  await insert('game_interactions', {
    user_id: 'fixture-player',
    game_id: 'fixture-game-0',
    kind: 'save',
    active: 1,
    tag_ids_json: JSON.stringify(tagIds),
    created_at: now + 5000,
    assignment_id: 'fixture-round-0',
  });
  await insert('ad_campaigns', {
    id: 'fixture-campaign',
    developer_id: 'fixture-studio-0',
    game_id: 'fixture-game-0',
    name: 'Synthetic funded campaign — no money moved',
    creative_json: JSON.stringify({
      title: 'Recovery fixture',
      image: `r2:${key}`,
    }),
    targeting_json: JSON.stringify({
      include: tagIds,
      exclude: [],
      mode: 'any',
    }),
    status: 'paused',
    moderation_status: 'approved',
    payment_status: 'paid',
    requested_impressions: 1000,
    paid_impressions: 1000,
    delivered: 1,
    start_at: now,
    end_at: now + 86400000,
    is_test: 1,
    created_at: now,
  });
  await insert('payments', {
    id: 'fixture-payment',
    user_id: 'fixture-owner',
    provider: 'lava',
    external_payment_id: 'synthetic-only-reference',
    purpose: 'campaign',
    campaign_id: 'fixture-campaign',
    amount_cents: 1000,
    currency: 'USD',
    status: 'paid',
    impressions: 1000,
    created_at: now,
    paid_at: now + 1000,
    provisioned_at: now + 1000,
  });
  await insert('payment_webhook_events', {
    id: 'fixture-event',
    provider: 'lava',
    event_key: 'synthetic-only-event',
    raw_hash: hash('synthetic event; never sent to a provider'),
    status: 'processed',
    created_at: now + 1000,
  });
  await insert('payments', {
    id: 'fixture-donation-payment',
    user_id: null,
    provider: 'tribute',
    external_payment_id: 'synthetic-donation-reference',
    purpose: 'donation',
    campaign_id: null,
    amount_cents: 100,
    currency: 'USD',
    status: 'paid',
    impressions: 0,
    created_at: now,
    paid_at: now + 1000,
    provisioned_at: now + 1000,
  });
  await insert('donations', {
    id: 'fixture-donation',
    payment_id: 'fixture-donation-payment',
    user_id: null,
    amount_cents: 100,
    currency: 'USD',
    created_at: now + 1000,
  });
  await insert('ad_offers', {
    id: 'fixture-offer',
    campaign_id: 'fixture-campaign',
    user_id: 'fixture-player',
    assignment_id: 'fixture-round-1',
    local_date: '2026-08-31',
    created_at: now,
    expires_at: now + 60000,
  });
  await insert('ad_impressions', {
    id: 'fixture-impression',
    offer_id: 'fixture-offer',
    campaign_id: 'fixture-campaign',
    user_id: 'fixture-player',
    local_date: '2026-08-31',
    viewable_ms: 1500,
    created_at: now + 1500,
  });
  await insert('ad_clicks', {
    impression_id: 'fixture-impression',
    created_at: now + 2000,
  });
  await insert('reports', {
    id: 'fixture-report',
    reporter_user_id: 'fixture-player',
    game_id: 'fixture-game-0',
    reason: 'technical',
    details: 'Synthetic report with a quote: "clue".',
    status: 'open',
    created_at: now,
  });
  await insert('moderation_actions', {
    id: 'fixture-audit',
    admin_user_id: 'fixture-admin',
    target_type: 'game',
    target_id: 'fixture-game-0',
    action: 'fixture',
    reason: 'Isolated recovery evidence only; no rights or payment assertion.',
    created_at: now,
  });
  await insert('site_config', {
    key: 'discovery_policy',
    value_json: JSON.stringify({
      policy: 'baseline',
      mmrLambda: 0.75,
      linucbAlpha: 0.35,
    }),
    updated_at: now,
  });
  await insert('rate_limits', {
    key: hash('synthetic-rate-bucket'),
    count: 1,
    expires_at: now + 60000,
  });
}
