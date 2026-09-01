import assert from 'node:assert/strict';
import { test, before, beforeEach, after } from 'node:test';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  compiled = resolve(root, 'tests/.runtime/harness.mjs');
let h,
  db,
  serial = 0;
const originalFetch = globalThis.fetch;
before(async () => {
  const output = await build({
    entryPoints: [resolve(root, 'tests/harness-entry.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    packages: 'external',
    write: false,
    alias: {
      'cloudflare:workers': resolve(root, 'tests/harness-environment.ts'),
      '@': root,
    },
    define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' },
    plugins: [
      {
        name: 'sql-raw',
        setup(builder) {
          builder.onResolve({ filter: /\.sql\?raw$/ }, (args) => ({
            path: resolve(
              root,
              args.path.replace(/^@\//, '').replace(/\?raw$/, ''),
            ),
            namespace: 'sql',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'sql' }, async (args) => ({
            contents: await readFile(args.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  await mkdir(dirname(compiled), { recursive: true });
  await writeFile(compiled, output.outputFiles[0].text);
  h = await import(pathToFileURL(compiled).href);
  db = await h.database();
});
beforeEach(async () => {
  await db.prepare("UPDATE games SET status='withdrawn' WHERE is_demo=0").run();
  await db
    .prepare("DELETE FROM site_config WHERE key='discovery_policy'")
    .run();
  await db.prepare("UPDATE ad_campaigns SET status='paused'").run();
  Object.assign(h.env, {
    CATALOG_MODE: 'live',
    BILLING_ENABLED: 'false',
    SITE_URL: 'https://findnewgame.example',
    LAVA_API_KEY: '',
    LAVA_OFFER_ID: '',
    LAVA_WEBHOOK_TOKEN: '',
    TRIBUTE_API_KEY: '',
    TRIBUTE_DONATION_URL: '',
  });
  globalThis.fetch = async () => {
    throw new Error('External network calls are disabled in isolated tests.');
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  db?.sqlite.close();
  await rm(compiled, { force: true });
});
const sql = (query, ...args) => db.prepare(query).bind(...args);
const tag = (name) => {
  const t = h.tags.find((t) => t.steam_name === name);
  assert.ok(t);
  return t.id;
};
void test('database startup accepts a schema already applied by the platform migration runner', async () => {
  // A new module instance owns a separate database and bootstrap promise.
  const boot = await import(
    `${pathToFileURL(compiled).href}?preapplied-migrations`
  );
  const journal = JSON.parse(
    await readFile(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'),
  );
  try {
    for (const entry of journal.entries) {
      boot.env.DB.sqlite.exec(
        await readFile(resolve(root, 'drizzle', `${entry.tag}.sql`), 'utf8'),
      );
    }
    const database = await boot.database();
    assert.equal(database, boot.env.DB);
    assert.deepEqual(
      database.sqlite
        .prepare(
          'SELECT version FROM schema_migrations WHERE length(version)=4 ORDER BY version',
        )
        .all()
        .map((row) => row.version),
      journal.entries.map((entry) => entry.tag.slice(0, 4)),
    );
    const columns = database.sqlite.prepare('PRAGMA table_info(users)').all();
    assert.equal(
      columns.filter((column) => column.name === 'd7_returned_at').length,
      1,
    );
    assert.equal(await boot.database(), database);
    assert.deepEqual(
      database.sqlite.prepare('PRAGMA foreign_key_check').all(),
      [],
    );
  } finally {
    boot.env.DB.sqlite.close();
  }
});
async function user(role = 'player') {
  const id = `test-user-${++serial}`,
    now = Date.now(),
    taste = {
      genres: [tag('Adventure'), tag('RPG'), tag('Strategy')],
      mechanics: [tag('Exploration')],
      moods: [],
      hardNo: [],
      discoveryMode: 'curious',
    };
  await db.batch([
    sql(
      'INSERT INTO users (id,email,display_name,role,is_demo,created_at,last_active_at) VALUES (?,?,?,?,0,?,?)',
      id,
      `${id}@example.test`,
      'Test participant',
      role,
      now,
      now,
    ),
    sql(
      "INSERT INTO user_profiles (user_id,timezone,taste_json,onboarding_complete,updated_at) VALUES (?,'UTC',?,1,?)",
      id,
      JSON.stringify(taste),
      now,
    ),
  ]);
  return {
    id,
    email: `${id}@example.test`,
    displayName: 'Test participant',
    role,
    timezone: 'UTC',
    taste,
    onboarded: true,
    isDemo: false,
    isLocal: true,
  };
}
async function game() {
  const owner = await user(),
    studio = await h.createDeveloper(owner, {
      name: `Test studio ${++serial}`,
    }),
    base = JSON.parse(
      await readFile(resolve(root, 'data/demo_games.json'), 'utf8'),
    )[0],
    body = {
      ...base,
      title: `Test game ${++serial}`,
      developer: studio.name,
      publisher: studio.name,
      steamUrl: `https://store.steampowered.com/app/${2000000000 + serial}/`,
      youtubeId: 'BrRWb7tFxR8',
      rightsConfirmed: true,
      noTitleConfirmed: true,
    },
    created = await h.submitGame(owner, body),
    admin = await user('admin');
  await h.moderate(admin, {
    type: 'game',
    id: created.id,
    action: 'approve',
    reason: 'Isolated test fixture only.',
  });
  return { id: created.id, owner, admin, body, studio };
}
async function ageStage(roundId) {
  await sql(
    'UPDATE daily_assignments SET stage_opened_at=? WHERE id=?',
    Date.now() - 1500,
    roundId,
  ).run();
}
async function finishRound(player, roundId, guess) {
  await h.startRound(player, roundId);
  await ageStage(roundId);
  return h.submitGuess(player, roundId, {
    ...guess,
    stage: 1,
    action: 'lock',
    wouldClick: 'yes',
  });
}
async function campaign(owner, isTest = false) {
  return h.createCampaign(owner, {
    name: 'Test campaign',
    title: 'A new adventure',
    description: 'An isolated test of sponsored delivery.',
    image:
      'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1562430/library_hero.jpg',
    destination: 'https://store.steampowered.com/app/1562430/',
    impressions: 1000,
    startAt: new Date(Date.now() - 60000).toISOString(),
    endAt: new Date(Date.now() + 86400000).toISOString(),
    isTest,
    targeting: {
      include: [tag('Adventure')],
      exclude: [],
      mode: 'any',
      minimum: 1,
    },
  });
}
async function tribute(data) {
  const raw = JSON.stringify(data),
    key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(h.env.TRIBUTE_API_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    ),
    signature = Buffer.from(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)),
    ).toString('hex');
  return h.handleWebhook(
    'tribute',
    new Request('https://findnewgame.example/api/webhooks/tribute', {
      method: 'POST',
      headers: { 'trbt-signature': signature },
      body: raw,
    }),
  );
}
const rejection = (status, code) => (error) =>
  error.status === status && (!code || error.code === code);
beforeEach(async () => {
  await sql(
    "UPDATE site_config SET value_json='1' WHERE key='impression_price_cents'",
  ).run();
});

// Register the full file before yielding; Node owns these test promises.
// Awaiting each registration can run the shared fixture cleanup too early.
void test('D7 measures an observed exact-day return, excluding previews, anonymous users, and unaged cohorts', async () => {
  const day = 86400000,
    base = Date.now() - 9 * day,
    people = await Promise.all(Array.from({ length: 4 }, () => user()));
  for (const person of people) {
    await sql(
      'UPDATE users SET created_at=?,last_active_at=? WHERE id=?',
      base,
      base,
      person.id,
    ).run();
    await h.recordUserActivity(db, person.id, true, base);
  }
  await h.recordUserActivity(db, people[0].id, true, base + 7 * day);
  await h.recordUserActivity(db, people[0].id, true, base + 9 * day);
  await h.recordUserActivity(db, people[1].id, true, base + 6 * day);
  await h.recordUserActivity(db, people[2].id, true, base + 8 * day);
  const preview = await user(),
    newcomer = await user(),
    anonymous = await user();
  await sql('UPDATE users SET is_demo=1 WHERE id=?', anonymous.id).run();
  await h.recordUserActivity(db, preview.id, false, base);
  await h.recordUserActivity(db, newcomer.id, true, base + 9 * day);
  await h.recordUserActivity(db, anonymous.id, true, base);
  const metrics = await h.productMetrics(db, base + 9 * day);
  assert.equal(metrics.d7Cohort, 4);
  assert.equal(metrics.d7Retention, 25);
  assert.equal(
    (
      await sql(
        'SELECT d7_returned_at FROM users WHERE id=?',
        people[0].id,
      ).first()
    ).d7_returned_at,
    base + 7 * day,
  );
  assert.equal(
    (
      await sql(
        'SELECT retention_started_at FROM users WHERE id=?',
        preview.id,
      ).first()
    ).retention_started_at,
    null,
  );
  assert.equal(
    (
      await sql(
        'SELECT retention_started_at FROM users WHERE id=?',
        anonymous.id,
      ).first()
    ).retention_started_at,
    null,
  );
  assert.ok(
    Object.values(metrics).every(
      (value) => value === null || typeof value === 'number',
    ),
  );
});

void test('discovery rollout is admin-only, audited, validated, and cannot rewrite assigned sets', async () => {
  await Promise.all([game(), game(), game()]);
  const player = await user(),
    admin = await user('admin'),
    initial = await h.discoverySettings(db);
  const body = {
    policy: 'linucb',
    relevanceWeight: 0.7,
    exploration: 0.4,
    reason: 'Enable an isolated test rollout.',
  };
  await assert.rejects(
    h.updateDiscoveryPolicy(db, player, body),
    rejection(403),
  );
  await assert.rejects(
    h.updateDiscoveryPolicy(db, admin, { ...body, relevanceWeight: 0.2 }),
    rejection(400),
  );
  assert.deepEqual(await h.discoverySettings(db), initial);
  const daily = await h.dailyFor(player),
    stored = (
      await sql(
        'SELECT selection_json FROM daily_sets WHERE id=?',
        daily.id,
      ).first()
    ).selection_json;
  assert.equal((await h.exportAccount(player)).discovery.length, 0);
  await h.updateDiscoveryPolicy(db, admin, body);
  assert.equal((await h.adminOverview()).config.discovery.policy, 'linucb');
  await h.dailyFor(player);
  assert.equal(
    (
      await sql(
        'SELECT selection_json FROM daily_sets WHERE id=?',
        daily.id,
      ).first()
    ).selection_json,
    stored,
  );
  const newcomer = await user(),
    next = await h.dailyFor(newcomer),
    decision = JSON.parse(
      (
        await sql(
          'SELECT selection_json FROM daily_sets WHERE id=?',
          next.id,
        ).first()
      ).selection_json,
    );
  assert.equal(decision.policy.requested, 'linucb');
  assert.equal(decision.policy.applied, 'mmr');
  assert.equal(decision.policy.feedbackSamples, 0);
  assert.match(decision.policy.fallbackReason, /20/);
  assert.ok(decision.decisions.every((row) => row.probability > 0));
  const cohorts = await h.discoveryOutcomes(db);
  assert.ok(cohorts.some((row) => row.policy === 'baseline' && row.sets >= 1));
  assert.ok(cohorts.some((row) => row.policy === 'mmr' && row.fallbacks === 1));
  const audit = await sql(
    "SELECT admin_user_id,reason FROM moderation_actions WHERE target_type='discovery' ORDER BY created_at DESC LIMIT 1",
  ).first();
  assert.equal(audit.admin_user_id, admin.id);
  assert.match(audit.reason, /baseline.*linucb.*isolated/);
});

async function discoveryFixture(g, player, index, options = {}) {
  const now = Date.now(),
    at = options.at ?? now - (index + 1) * 86400000,
    date = new Date(at).toISOString().slice(0, 10),
    setId = `learn-day-${++serial}`,
    roundId = `learn-round-${++serial}`,
    row = await sql('SELECT * FROM games WHERE id=?', g.id).first(),
    features = options.features ?? [1, index % 2, 0.5, 0.2, 0, 0, 0, 0],
    selection = {
      policy: { featureVersion: 'affinity-v1' },
      decisions: [{ gameId: g.id, features, probability: 0.2 }],
    };
  await db.batch([
    sql(
      "INSERT INTO daily_sets (id,user_id,local_date,timezone,reset_at,catalog_mode,algorithm_version,selection_json,created_at,completed_at) VALUES (?,?,?,'UTC',?,'live','fixture',?,?,?)",
      setId,
      player.id,
      date,
      at + 1000,
      JSON.stringify(selection),
      at,
      at,
    ),
    sql(
      "INSERT INTO daily_assignments (id,set_id,user_id,local_date,slot,game_id,developer_id,publisher_key,family_key,version_id,status,stage,created_at,completed_at) VALUES (?,?,?,?,1,?,?,?,?,?,'complete',1,?,?)",
      roundId,
      setId,
      player.id,
      date,
      g.id,
      row.developer_id,
      row.publisher_key,
      row.family_key,
      row.current_version_id,
      at,
      at,
    ),
    sql(
      "INSERT INTO quiz_final_results (assignment_id,game_id,user_id,version_id,score,accuracy,stage,result_json,qualified,repeat_exposure,completed_at) VALUES (?,?,?,?,0,0,1,'{}',?,?,?)",
      roundId,
      g.id,
      player.id,
      row.current_version_id,
      options.qualified ?? 1,
      options.repeat ?? 0,
      at,
    ),
  ]);
  if (options.rated !== false)
    await h.interact(player, roundId, index % 2 ? 'would_play' : 'not_for_me');
  return { setId, roundId, features };
}

void test('contextual learning uses distinct qualified live feedback, frozen context and current undo state', async () => {
  const player = await user(),
    games = [],
    rounds = [];
  for (let i = 0; i < 20; i++) {
    const g = await game();
    games.push(g);
    rounds.push(await discoveryFixture(g, player, i));
  }
  const feedback = await h.discoveryFeedback(db, player);
  assert.equal(feedback.length, 20);
  const exported = await h.exportAccount(player);
  assert.equal(exported.discovery.length, 20);
  assert.ok(
    exported.discovery.every(
      (row) => Array.isArray(row.features) && !('gameId' in row),
    ),
  );
  assert.equal(feedback.filter((row) => row.reward === 1).length, 10);
  player.taste = { ...player.taste, genres: [tag('Sports')], mechanics: [] };
  assert.deepEqual(await h.discoveryFeedback(db, player), feedback);
  assert.deepEqual(await h.discoveryFeedback(db, await user()), []);
  assert.deepEqual(
    await h.discoveryFeedback(db, { ...player, isDemo: true }),
    [],
  );
  await sql('UPDATE games SET is_demo=1 WHERE id=?', games[0].id).run();
  assert.equal((await h.discoveryFeedback(db, player)).length, 19);
  await sql('UPDATE games SET is_demo=0 WHERE id=?', games[0].id).run();
  await h.interact(player, rounds[0].roundId, 'save');
  assert.equal((await h.discoveryFeedback(db, player))[0].reward, 0);
  await h.interact(player, rounds[0].roundId, 'not_for_me', false);
  assert.equal((await h.discoveryFeedback(db, player))[0].reward, 1);
  await h.interact(player, rounds[0].roundId, 'save', false);
  assert.equal((await h.discoveryFeedback(db, player)).length, 19);
  await h.interact(player, rounds[0].roundId, 'not_for_me');
  await sql(
    'UPDATE quiz_final_results SET accuracy=999,score=999999 WHERE user_id=?',
    player.id,
  ).run();
  assert.deepEqual(await h.discoveryFeedback(db, player), feedback);
  const excluded = [
    { qualified: 0 },
    { repeat: 1 },
    { rated: false },
    { features: [1] },
    { at: Date.now() - 91 * 86400000 },
  ];
  for (let i = 0; i < excluded.length; i++)
    await discoveryFixture(await game(), player, 22 + i, excluded[i]);
  assert.equal((await h.discoveryFeedback(db, player)).length, 20);
  await Promise.all([game(), game(), game()]);
  await h.updateDiscoveryPolicy(db, await user('admin'), {
    policy: 'linucb',
    relevanceWeight: 0.7,
    exploration: 0.4,
    reason: 'Test activation only after real-shaped evidence.',
  });
  const next = await h.dailyFor(player),
    decision = JSON.parse(
      (
        await sql(
          'SELECT selection_json FROM daily_sets WHERE id=?',
          next.id,
        ).first()
      ).selection_json,
    );
  assert.equal(decision.policy.applied, 'linucb');
  assert.equal(decision.policy.feedbackSamples, 20);
  assert.equal(decision.policy.fallbackReason, null);
  assert.equal(next.slots.length, 3);
  assert.ok(
    decision.decisions.every(
      (row) => row.probability > 0 && row.probability <= 1,
    ),
  );
  await sql(
    'UPDATE quiz_final_results SET qualified=0 WHERE assignment_id=?',
    rounds[0].roundId,
  ).run();
  assert.equal((await h.discoveryFeedback(db, player)).length, 19);
});

void test('launch discovery metrics require real starts and keep preference diagnostics frozen with each Daily', async () => {
  const games = await Promise.all([game(), game(), game()]),
    player = await user(),
    before = await h.adminOverview();
  player.taste = {
    ...player.taste,
    genres: [tag('Sports'), tag('Racing'), tag('Casual')],
  };
  const daily = await h.dailyFor(player),
    stored = (
      await sql(
        'SELECT selection_json FROM daily_sets WHERE id=?',
        daily.id,
      ).first()
    ).selection_json,
    diagnostics = JSON.parse(stored);
  assert.equal(daily.slots.length, 3);
  assert.equal(diagnostics.outsideFocusGameIds.length, 3);
  assert.ok(Math.abs(diagnostics.meanPairwiseSimilarity - 1) < 1e-10);
  assert.equal(
    (await h.adminOverview()).metrics.setsStarted,
    before.metrics.setsStarted,
  );
  await finishRound(player, daily.slots[0].id, games[0].body.targets);
  assert.equal(
    (await h.adminOverview()).metrics.setsStarted,
    before.metrics.setsStarted + 1,
  );
  await h.interact(player, daily.slots[0].id, 'would_play');
  let metrics = await h.productMetrics(db);
  assert.equal(metrics.outsideFocusRatings, 1);
  assert.equal(metrics.serendipityRate, 100);
  player.taste.genres = [tag('Adventure'), tag('RPG'), tag('Strategy')];
  await h.dailyFor(player);
  assert.equal(
    (
      await sql(
        'SELECT selection_json FROM daily_sets WHERE id=?',
        daily.id,
      ).first()
    ).selection_json,
    stored,
  );
  await h.interact(player, daily.slots[0].id, 'not_for_me');
  metrics = await h.productMetrics(db);
  assert.equal(metrics.outsideFocusRatings, 1);
  assert.equal(metrics.serendipityRate, 0);
  assert.equal(metrics.measuredDailySets, before.metrics.measuredDailySets + 1);
});

void test('developer value waits for a 100-person material version and ad repurchase excludes tests and refunds', async () => {
  const g = await game(),
    baseline = await h.productMetrics(db);
  await h.developerDashboard(g.owner);
  for (let index = 0; index < 100; index++) {
    const participant = await user(),
      daily = await h.dailyFor(participant);
    await finishRound(participant, daily.slots[0].id, g.body.targets);
    if (index === 98)
      assert.equal(
        (await h.productMetrics(db)).calibratedDevelopers,
        baseline.calibratedDevelopers,
      );
  }
  let metrics = await h.productMetrics(db);
  assert.equal(metrics.calibratedDevelopers, baseline.calibratedDevelopers + 1);
  assert.equal(metrics.developerReturnRate, 0);
  assert.equal(metrics.developerIterationRate, 0);
  await h.developerDashboard(g.owner);
  await h.submitGame(
    g.owner,
    {
      ...g.body,
      description:
        'A revised, clearly different description after the first useful calibration sample.',
    },
    g.id,
  );
  metrics = await h.productMetrics(db);
  assert.equal(metrics.developerReturnRate, 100);
  assert.equal(metrics.developerIterationRate, 100);
  const c1 = await campaign(g.owner),
    c2 = await campaign(g.owner),
    testCampaign = await campaign(g.owner, true);
  for (const c of [c1, c2, testCampaign])
    await sql(
      "UPDATE ad_campaigns SET payment_status='paid',paid_impressions=1000 WHERE id=?",
      c.id,
    ).run();
  metrics = await h.productMetrics(db);
  assert.equal(metrics.payingCampaigns, baseline.payingCampaigns + 2);
  assert.equal(metrics.payingAdvertisers, baseline.payingAdvertisers + 1);
  assert.equal(metrics.advertiserRepeatRate, 100);
  await sql(
    "UPDATE ad_campaigns SET payment_status='refunded' WHERE id=?",
    c2.id,
  ).run();
  assert.equal((await h.productMetrics(db)).advertiserRepeatRate, 0);
});

void test('a verified sample studio claim requires a new rights-confirmed version before live approval', async () => {
  const owner = await user(),
    admin = await user('admin'),
    sample = JSON.parse(
      await readFile(resolve(root, 'data/demo_games.json'), 'utf8'),
    )[0],
    body = {
      steamUrl: sample.steamUrl,
      ownerEmail: owner.email,
      ownershipVerified: true,
      reason: 'Verified studio ownership in an isolated test fixture only.',
    };
  await assert.rejects(h.claimSampleStudio(owner, body), rejection(403));
  await assert.rejects(
    h.claimSampleStudio(admin, { ...body, ownershipVerified: false }),
    rejection(400),
  );
  await h.claimSampleStudio(admin, body);
  const owned = await h.ownedGame(owner, sample.id);
  assert.equal(owned.is_demo, 1);
  assert.equal(owned.status, 'changes_requested');
  await assert.rejects(
    h.moderate(admin, {
      type: 'game',
      id: sample.id,
      action: 'approve',
      reason: 'An old sample must not be approved.',
    }),
    rejection(400),
  );
  const revision = await h.submitGame(
    owner,
    {
      ...sample,
      youtubeId: 'BrRWb7tFxR8',
      rightsConfirmed: true,
      noTitleConfirmed: true,
    },
    sample.id,
  );
  assert.ok(revision.version > owned.version);
  assert.equal((await h.ownedGame(owner, sample.id)).is_demo, 0);
  await h.moderate(admin, {
    type: 'game',
    id: sample.id,
    action: 'approve',
    reason: 'Fresh rights-confirmed test materials reviewed.',
  });
  await assert.rejects(
    h.claimSampleStudio(admin, body),
    rejection(409, 'claim_unavailable'),
  );
  assert.equal(
    (
      await sql(
        "SELECT COUNT(*) n FROM moderation_actions WHERE target_type='studio' AND action='claim'",
      ).first()
    ).n,
    1,
  );
});
void test('team testers lose calibration qualification without gaining studio access or restoring old results on removal', async () => {
  const g = await game(),
    member = await user(),
    day = await h.dailyFor(member);
  await finishRound(member, day.slots[0].id, g.body.targets);
  assert.equal((await h.calibrationReport(g.owner, g.id)).sampleSize, 1);
  await h.updateStudioTeam(g.owner, { action: 'add', email: member.email });
  await h.updateStudioTeam(g.owner, { action: 'add', email: member.email });
  assert.equal((await h.studioTeam(g.owner)).members.length, 2);
  assert.equal((await h.calibrationReport(g.owner, g.id)).sampleSize, 0);
  assert.equal(
    (
      await sql(
        'SELECT qualified FROM quiz_stage_guesses WHERE assignment_id=?',
        day.slots[0].id,
      ).first()
    ).qualified,
    0,
  );
  await assert.rejects(h.ownedGame(member, g.id), rejection(404));
  await assert.rejects(h.studioTeam(member), rejection(403));
  await assert.rejects(
    h.updateStudioTeam(g.owner, { action: 'remove', userId: g.owner.id }),
    rejection(400),
  );
  await h.updateStudioTeam(g.owner, { action: 'remove', userId: member.id });
  assert.equal((await h.calibrationReport(g.owner, g.id)).sampleSize, 0);
});
void test('inactive targets cannot enter a Daily and disabling a genre never weakens an explicit exclusion', async () => {
  const g = await game(),
    target = g.body.targets.genre[0];
  await sql('UPDATE steam_tags SET is_active=0 WHERE id=?', target).run();
  try {
    assert.equal((await h.dailyFor(await user())).slots.length, 0);
  } finally {
    await sql('UPDATE steam_tags SET is_active=1 WHERE id=?', target).run();
  }
  const fps = tag('FPS');
  await h.submitGame(
    g.owner,
    {
      ...g.body,
      tagIds: [...new Set([...Object.values(g.body.targets).flat(), fps])],
    },
    g.id,
  );
  await h.moderate(g.admin, {
    type: 'game',
    id: g.id,
    action: 'approve',
    reason: 'Test tags updated for hard exclusions.',
  });
  await sql('UPDATE steam_tags SET is_active=0 WHERE id=?', fps).run();
  try {
    const player = await user();
    player.taste.hardNo = [fps];
    assert.equal((await h.dailyFor(player)).slots.length, 0);
  } finally {
    await sql('UPDATE steam_tags SET is_active=1 WHERE id=?', fps).run();
  }
});
void test('the store description stays hidden through every clue and appears only after reveal', async () => {
  const g = await game(),
    title = 'Test Game [2] + (Demo)',
    description = `${title} is a mystery. Discover ${title} through careful exploration.`;
  await h.submitGame(g.owner, { ...g.body, title, description }, g.id);
  await h.moderate(g.admin, {
    type: 'game',
    id: g.id,
    action: 'approve',
    reason: 'Isolated post-reveal description fixture.',
  });
  const player = await user(),
    day = await h.dailyFor(player),
    id = day.slots[0].id;
  await h.startRound(player, id);
  for (let stage = 1; stage < 4; stage++) {
    await ageStage(id);
    await h.submitGuess(player, id, {
      genre: [],
      core: [],
      mood: [],
      wouldClick: null,
      action: 'clue',
      stage,
    });
  }
  const clue = await h.roundView(player, id);
  assert.equal(Object.hasOwn(clue, 'description'), false);
  assert.ok(!JSON.stringify(clue).includes(description));
  assert.equal(clue.result, null);
  await ageStage(id);
  const final = await h.submitGuess(player, id, {
    ...g.body.targets,
    wouldClick: 'yes',
    action: 'lock',
    stage: 4,
  });
  assert.equal(final.result.game.description, description);
});
void test('stale moderation cannot approve replaced game materials or reopen a completed experiment', async () => {
  const g = await game(),
    old = await h.ownedGame(g.owner, g.id),
    exp = await h.createExperiment(g.owner, {
      gameId: g.id,
      name: 'Old presentation',
      kind: 'description',
      value: 'An old experimental presentation that will be superseded.',
    });
  await h.submitGame(
    g.owner,
    {
      ...g.body,
      description: 'A new description that must be reviewed in its own right.',
    },
    g.id,
  );
  await assert.rejects(
    h.moderate(g.admin, {
      type: 'game',
      id: g.id,
      versionId: old.current_version_id,
      action: 'approve',
      reason: 'Stale modal must not approve unseen assets.',
    }),
    rejection(409, 'review_changed'),
  );
  await h.moderate(g.admin, {
    type: 'game',
    id: g.id,
    action: 'approve',
    reason: 'Current test materials reviewed.',
  });
  await assert.rejects(
    h.moderate(g.admin, {
      type: 'experiment',
      id: exp.id,
      action: 'approve',
      reason: 'Superseded experiment must remain closed.',
    }),
    rejection(409),
  );
  assert.equal(
    (await sql('SELECT status FROM experiments WHERE id=?', exp.id).first())
      .status,
    'completed',
  );
});
void test('intent reporting remains tied to the reacted-to material version', async () => {
  const g = await game(),
    old = (await h.ownedGame(g.owner, g.id)).current_version_id;
  for (let i = 0; i < 20; i++) {
    const p = await user(),
      d = await h.dailyFor(p);
    await finishRound(p, d.slots[0].id, g.body.targets);
    await h.interact(p, d.slots[0].id, 'would_play');
  }
  assert.equal((await h.calibrationReport(g.owner, g.id)).wouldPlay, 100);
  await h.submitGame(
    g.owner,
    {
      ...g.body,
      description:
        'Revised materials whose intent must be evaluated independently.',
    },
    g.id,
  );
  await h.moderate(g.admin, {
    type: 'game',
    id: g.id,
    action: 'approve',
    reason: 'Independent intent version fixture.',
  });
  const fresh = [];
  for (let i = 0; i < 20; i++) {
    const p = await user(),
      d = await h.dailyFor(p);
    await finishRound(p, d.slots[0].id, g.body.targets);
    fresh.push([p, d.slots[0].id]);
  }
  const next = await h.calibrationReport(g.owner, g.id);
  assert.equal(next.sampleSize, 20);
  assert.equal(
    next.wouldPlay,
    null,
    'old-version reactions cannot fill the new-version intent sample',
  );
  for (const [p, id] of fresh) await h.interact(p, id, 'not_for_me');
  assert.equal((await h.calibrationReport(g.owner, g.id)).wouldPlay, 0);
  assert.equal((await h.calibrationReport(g.owner, g.id, old)).wouldPlay, 100);
});
void test('image reservations enforce the account quota under concurrency and recover absent stale uploads', async () => {
  const owner = await user(),
    now = Date.now(),
    png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
      'base64',
    );
  await sql(
    'INSERT INTO uploads (id,owner_user_id,object_key,sha256,content_type,size,created_at) VALUES (?,?,?,?,?,?,?)',
    `quota-${++serial}`,
    owner.id,
    `images/test-${serial}`,
    'a'.repeat(64),
    'image/png',
    98 * 1048576,
    now,
  ).run();
  const request = (bytes) =>
    new Request('https://findnewgame.example/api/assets/upload', {
      method: 'POST',
      body: bytes,
    });
  const bytes = Buffer.alloc(2 * 1048576);
  png.copy(bytes);
  const other = Buffer.from(bytes);
  other[other.length - 1] = 1;
  const results = await Promise.allSettled([
    h.uploadImage(owner, request(bytes)),
    h.uploadImage(owner, request(other)),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 413);
  assert.equal(
    (
      await sql(
        'SELECT SUM(size) n FROM uploads WHERE owner_user_id=?',
        owner.id,
      ).first()
    ).n,
    100 * 1048576,
  );
  const fresh = await user(),
    uploaded = await h.uploadImage(fresh, request(png));
  await h.env.FILES.delete(uploaded.reference.slice(3));
  await assert.rejects(
    h.uploadImage(fresh, request(png)),
    rejection(409, 'upload_pending'),
  );
  await sql(
    'UPDATE uploads SET created_at=? WHERE owner_user_id=?',
    now - 16 * 60000,
    fresh.id,
  ).run();
  const repaired = await h.uploadImage(fresh, request(png));
  assert.equal(repaired.reference, uploaded.reference);
  assert.equal(repaired.deduplicated, false);
  assert.ok(await h.env.FILES.head(repaired.reference.slice(3)));
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM uploads WHERE owner_user_id=?',
        fresh.id,
      ).first()
    ).n,
    1,
  );
});
void test('expired-data maintenance preserves signed-in profiles and active anonymous sessions', async () => {
  const permanent = await user(),
    expired = await user(),
    active = await user(),
    now = Date.now();
  await sql(
    'UPDATE users SET is_demo=1 WHERE id IN (?,?)',
    expired.id,
    active.id,
  ).run();
  await sql(
    'INSERT INTO demo_sessions (token_hash,user_id,expires_at) VALUES (?,?,?),(?,?,?)',
    `expired-${serial}`,
    expired.id,
    now - 1,
    `active-${serial}`,
    active.id,
    now + 86400000,
  ).run();
  const cleaned = await h.cleanTransientData(db, now);
  assert.equal(cleaned.expiredDemoUsers, 1);
  assert.equal(
    await sql('SELECT id FROM users WHERE id=?', expired.id).first(),
    null,
  );
  assert.ok(await sql('SELECT id FROM users WHERE id=?', permanent.id).first());
  assert.ok(await sql('SELECT id FROM users WHERE id=?', active.id).first());
});
void test('operator price and tag edits record the actor and preserve immutable identifiers', async () => {
  const admin = await user('admin'),
    unused = await sql(
      "SELECT id,name FROM steam_tags t WHERE NOT EXISTS (SELECT 1 FROM game_versions v,json_each(v.content_json,'$.tagIds') j WHERE j.value=t.id) LIMIT 1",
    ).first();
  assert.ok(unused);
  await h.updateTag(admin, { id: unused.id, active: false });
  await h.updateTag(admin, { id: unused.id, active: true });
  assert.equal(
    (await sql('SELECT name FROM steam_tags WHERE id=?', unused.id).first())
      .name,
    unused.name,
  );
  await h.updatePrice(admin, { impressionPriceCents: 2 });
  assert.equal((await h.adminOverview()).config.impressionPriceCents, 2);
  await h.updatePrice(admin, { impressionPriceCents: 1 });
  const logs = await sql(
    'SELECT target_type,reason FROM moderation_actions WHERE admin_user_id=? ORDER BY created_at',
    admin.id,
  ).all();
  assert.equal(logs.results.length, 4);
  assert.ok(
    logs.results.some((row) => row.reason.includes('Changed from 1 to 2')),
  );
});
void test('daily assignments remain identical under competing requests and satisfy database uniqueness', async () => {
  await game();
  await game();
  await game();
  const player = await user();
  const days = await Promise.all(
    Array.from({ length: 8 }, () => h.dailyFor(player)),
  );
  assert.equal(new Set(days.map((d) => d.id)).size, 1);
  assert.ok(days.every((d) => d.slots.length === 3));
  assert.equal(new Set(days.map((d) => JSON.stringify(d.slots))).size, 1);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM daily_assignments WHERE user_id=?',
        player.id,
      ).first()
    ).n,
    3,
  );
});
void test('quiz response withholds answers, gates later assets, checks ownership, speed, and stage', async () => {
  const g = await game(),
    player = await user(),
    stranger = await user(),
    day = await h.dailyFor(player),
    roundId = day.slots[0].id,
    view = await h.startRound(player, roundId);
  assert.equal(view.result, null);
  assert.equal(Object.hasOwn(view, 'description'), false);
  assert.equal(view.youtubeId, null);
  assert.deepEqual(view.screenshots, []);
  assert.ok(!JSON.stringify(view).includes(g.body.title));
  await assert.rejects(h.roundView(stranger, roundId), rejection(404));
  await assert.rejects(
    h.roundAsset(player, roundId, 1),
    rejection(403, 'clue_locked'),
  );
  await assert.rejects(
    h.submitGuess(player, roundId, {
      ...g.body.targets,
      stage: 1,
      action: 'lock',
      wouldClick: 'yes',
    }),
    rejection(429, 'too_fast'),
  );
  await ageStage(roundId);
  await assert.rejects(
    h.submitGuess(player, roundId, {
      ...g.body.targets,
      core: [
        tag('Building'),
        tag('Combat'),
        tag('Crafting'),
        tag('Resource Management'),
      ],
      stage: 1,
      action: 'lock',
      wouldClick: 'yes',
    }),
    rejection(400),
  );
  await assert.rejects(
    h.submitGuess(player, roundId, {
      ...g.body.targets,
      stage: 4,
      action: 'lock',
      wouldClick: 'yes',
    }),
    rejection(409, 'stage_conflict'),
  );
});
void test('all four clues advance once under retries; scores are server-owned and final results immutable', async () => {
  const g = await game(),
    player = await user(),
    day = await h.dailyFor(player),
    id = day.slots[0].id;
  await h.startRound(player, id);
  for (let stage = 1; stage < 4; stage++) {
    await ageStage(id);
    const body = {
      genre: [],
      core: [],
      mood: [],
      wouldClick: null,
      action: 'clue',
      stage,
    };
    const responses = await Promise.allSettled([
      h.submitGuess(player, id, body),
      h.submitGuess(player, id, body),
    ]);
    assert.ok(responses.some((r) => r.status === 'fulfilled'));
    assert.equal((await h.roundView(player, id)).stage, stage + 1);
  }
  await ageStage(id);
  const result = await h.submitGuess(player, id, {
    ...g.body.targets,
    action: 'lock',
    stage: 4,
    wouldClick: 'yes',
    score: 999999,
    accuracy: 0,
  });
  assert.equal(result.result.score, 500);
  assert.equal(result.result.accuracy, 100);
  const retry = await h.submitGuess(player, id, {
    genre: [],
    core: [],
    mood: [],
    wouldClick: null,
    stage: 1,
    action: 'clue',
  });
  assert.equal(retry.result.score, 500);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM quiz_stage_guesses WHERE assignment_id=?',
        id,
      ).first()
    ).n,
    4,
  );
  assert.equal(
    (await h.dailyFor(player)).complete,
    false,
    'one available game is not a complete three-game Daily',
  );
});
void test('legacy in-progress stages finish through the new trailer stage without rewriting stored history', async () => {
  const g = await game(),
    player = await user(),
    day = await h.dailyFor(player),
    id = day.slots[0].id;
  await h.startRound(player, id);
  await sql(
    'UPDATE daily_assignments SET stage=6,stage_opened_at=? WHERE id=?',
    Date.now() - 1500,
    id,
  ).run();
  assert.equal((await h.roundView(player, id)).stage, 4);
  const result = await h.submitGuess(player, id, {
    ...g.body.targets,
    action: 'lock',
    stage: 4,
    wouldClick: 'yes',
  });
  assert.equal(result.result.stage, 4);
  assert.equal(result.result.score, 500);
  assert.equal(
    (
      await sql(
        'SELECT stage FROM quiz_final_results WHERE assignment_id=?',
        id,
      ).first()
    ).stage,
    6,
  );
  assert.equal((await h.dailyFor(player)).slots[0].stage, 4);
});
void test('game submissions cap every target group at three and require HTTPS official links', async () => {
  const g = await game(),
    core = [
      tag('Building'),
      tag('Combat'),
      tag('Crafting'),
      tag('Resource Management'),
    ];
  await assert.rejects(
    h.submitGame(
      g.owner,
      {
        ...g.body,
        tagIds: [...new Set([...g.body.tagIds, ...core])],
        targets: { ...g.body.targets, core },
      },
      g.id,
    ),
    rejection(400),
  );
  await assert.rejects(
    h.submitGame(
      g.owner,
      { ...g.body, officialUrl: 'http://insecure.example/game' },
      g.id,
    ),
    rejection(400),
  );
});
void test('three zero-score reveals complete a Daily and award the streak once', async () => {
  await game();
  await game();
  await game();
  const player = await user(),
    day = await h.dailyFor(player);
  for (const slot of day.slots)
    await finishRound(player, slot.id, {
      genre: [tag('FPS')],
      core: [tag('Deckbuilding')],
      mood: [],
    });
  const final = await h.dailyFor(player);
  assert.equal(final.totalScore, 0);
  assert.equal(final.complete, true);
  assert.equal(final.currentStreak, 1);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM quiz_final_results WHERE user_id=?',
        player.id,
      ).first()
    ).n,
    3,
  );
});
void test('daily relevance survives reloads and remains scoped to its completed owner', async () => {
  await game();
  await game();
  await game();
  const player = await user(),
    day = await h.dailyFor(player),
    guess = {
      genre: [tag('FPS')],
      core: [tag('Deckbuilding')],
      mood: [],
    };
  assert.equal(day.relevance, null);
  await assert.rejects(h.rateDaily(player, day.id, 'mixed'), rejection(409));
  for (const slot of day.slots) await finishRound(player, slot.id, guess);
  assert.deepEqual(await h.rateDaily(player, day.id, 'mixed'), {
    ok: true,
    relevance: 'mixed',
  });
  assert.equal((await h.dailyFor(player)).relevance, 'mixed');
  await assert.rejects(
    h.rateDaily(await user(), day.id, 'yes'),
    rejection(409),
  );
  await assert.rejects(h.rateDaily(player, day.id, 'invalid'), rejection(400));
});
void test('saving and following are idempotent and correctness never mutates taste', async () => {
  const g = await game(),
    player = await user(),
    before = await sql(
      'SELECT taste_json FROM user_profiles WHERE user_id=?',
      player.id,
    ).first(),
    day = await h.dailyFor(player),
    id = day.slots[0].id;
  await finishRound(player, id, g.body.targets);
  assert.deepEqual(
    await sql(
      'SELECT taste_json FROM user_profiles WHERE user_id=?',
      player.id,
    ).first(),
    before,
  );
  await Promise.all([
    h.interact(player, id, 'save'),
    h.interact(player, id, 'save'),
    h.interact(player, id, 'follow'),
  ]);
  assert.equal((await h.collection(player)).games.length, 1);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM game_interactions WHERE user_id=?',
        player.id,
      ).first()
    ).n,
    2,
  );
  await h.interact(player, id, 'would_play');
  await h.interact(player, id, 'not_for_me');
  assert.equal(
    (
      await sql(
        "SELECT active FROM game_interactions WHERE user_id=? AND kind='would_play'",
        player.id,
      ).first()
    ).active,
    0,
  );
});
void test('target edits create immutable versions and old assigned rounds retain their exact materials', async () => {
  const g = await game(),
    player = await user(),
    day = await h.dailyFor(player),
    old = await sql(
      'SELECT version_id FROM daily_assignments WHERE id=?',
      day.slots[0].id,
    ).first();
  const revision = await h.submitGame(
    g.owner,
    {
      ...g.body,
      description:
        'A newly revised presentation for this isolated game fixture.',
    },
    g.id,
  );
  assert.equal(revision.version, 2);
  assert.equal((await h.ownedGame(g.owner, g.id)).status, 'pending_review');
  assert.equal(
    (
      await sql(
        'SELECT content_json FROM game_versions WHERE id=?',
        old.version_id,
      ).first()
    ).content_json.includes(g.body.description),
    true,
  );
  assert.equal((await h.startRound(player, day.slots[0].id)).status, 'playing');
  await assert.rejects(
    h.submitGame(
      g.owner,
      {
        ...g.body,
        screenshots: [
          g.body.screenshots[0],
          g.body.screenshots[0],
          g.body.screenshots[0],
        ],
      },
      g.id,
    ),
    rejection(400),
  );
});
void test('only one open experiment survives concurrent proposals', async () => {
  const g = await game(),
    body = {
      gameId: g.id,
      name: 'Alternative description',
      kind: 'description',
      value: 'An alternative English description for an isolated comparison.',
    };
  const attempts = await Promise.allSettled([
    h.createExperiment(g.owner, body),
    h.createExperiment(g.owner, body),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      await sql(
        "SELECT COUNT(*) n FROM experiments WHERE game_id=? AND status='pending_review'",
        g.id,
      ).first()
    ).n,
    1,
  );
});
void test('explicit retests use changed variant B once and never repeat an existing cohort', async () => {
  const g = await game(),
    player = await user();
  const expire = async (days) => {
    const now = Date.now() - days * 86400000,
      date = new Date(now).toISOString().slice(0, 10);
    await sql(
      'UPDATE daily_sets SET local_date=?,created_at=?,reset_at=? WHERE user_id=?',
      date,
      now,
      now + 3600000,
      player.id,
    ).run();
    await sql(
      'UPDATE daily_assignments SET local_date=?,created_at=? WHERE user_id=?',
      date,
      now,
      player.id,
    ).run();
  };
  await h.dailyFor(player);
  await expire(15);
  const exp = await h.createExperiment(g.owner, {
    gameId: g.id,
    name: 'Changed materials retest',
    kind: 'description',
    value: 'A different description for a fresh look after the cooldown.',
    isRetest: true,
  });
  await h.moderate(g.admin, {
    type: 'experiment',
    id: exp.id,
    action: 'approve',
    reason: 'Isolated retest fixture.',
  });
  const second = await h.dailyFor(player);
  assert.equal(second.slots.length, 1);
  const row = await sql(
    'SELECT a.repeat_exposure,v.label FROM daily_assignments a JOIN experiment_variants v ON v.id=a.variant_id WHERE a.id=?',
    second.slots[0].id,
  ).first();
  assert.equal(row.repeat_exposure, 1);
  assert.equal(row.label, 'B');
  const latest = await h.roundView(player, second.slots[0].id);
  assert.equal(latest.repeatExposure, true);
  const date = new Date(Date.now() - 16 * 86400000).toISOString().slice(0, 10);
  await sql(
    'UPDATE daily_sets SET local_date=?,reset_at=? WHERE id=?',
    date,
    Date.now() - 1,
    second.id,
  ).run();
  await sql(
    'UPDATE daily_assignments SET local_date=?,created_at=? WHERE set_id=?',
    date,
    Date.now() - 16 * 86400000,
    second.id,
  ).run();
  assert.equal((await h.dailyFor(player)).slots.length, 0);
});
void test('calibration stays suppressed at 19 independent participants and opens at 20 without personal identifiers', async () => {
  const g = await game();
  for (let i = 0; i < 19; i++) {
    const p = await user(),
      day = await h.dailyFor(p);
    await finishRound(p, day.slots[0].id, g.body.targets);
  }
  const hidden = await h.calibrationReport(g.owner, g.id);
  assert.equal(hidden.sampleSize, 19);
  assert.equal(hidden.privacySuppressed, true);
  assert.deepEqual(hidden.funnel, []);
  const p = await user(),
    day = await h.dailyFor(p);
  await finishRound(p, day.slots[0].id, g.body.targets);
  const visible = await h.calibrationReport(g.owner, g.id);
  assert.equal(visible.sampleSize, 20);
  assert.equal(visible.privacySuppressed, false);
  assert.equal(visible.funnel[0].accuracy, 100);
  assert.ok(!JSON.stringify(visible).includes(p.id));
  assert.ok(!JSON.stringify(visible).includes(p.email));
  const ownDay = await h.dailyFor(g.owner);
  await finishRound(g.owner, ownDay.slots[0].id, g.body.targets);
  assert.equal((await h.calibrationReport(g.owner, g.id)).sampleSize, 20);
});
void test('viewable impressions honor the continuous interval, frequency cap, and final available budget under contention', async () => {
  const g = await game(),
    advertiser = await user();
  await h.createDeveloper(advertiser, { name: `Test advertiser ${++serial}` });
  const c = await campaign(advertiser, true);
  await h.moderate(g.admin, {
    type: 'campaign',
    id: c.id,
    action: 'approve',
    reason: 'Local test creative.',
  });
  await h.fundTestCampaign(c.id);
  await sql(
    'UPDATE ad_campaigns SET paid_impressions=1,start_at=? WHERE id=?',
    Date.now() - 86400000,
    c.id,
  ).run();
  const p = await user(),
    q = await user(),
    pd = await h.dailyFor(p),
    qd = await h.dailyFor(q),
    po = (await h.nextAd(p, pd.slots[0].id)).ad,
    qo = (await h.nextAd(q, qd.slots[0].id)).ad;
  assert.ok(po && qo);
  await sql(
    'UPDATE ad_offers SET created_at=? WHERE id IN (?,?)',
    Date.now() - 1500,
    po.offerId,
    qo.offerId,
  ).run();
  await assert.rejects(
    h.recordImpression(p, {
      offerId: po.offerId,
      ratio: 0.49,
      visibleMs: 1200,
    }),
    rejection(400),
  );
  await Promise.all([
    h.recordImpression(p, { offerId: po.offerId, ratio: 0.5, visibleMs: 1100 }),
    h.recordImpression(q, { offerId: qo.offerId, ratio: 0.8, visibleMs: 1500 }),
  ]);
  assert.equal(
    (await sql('SELECT delivered FROM ad_campaigns WHERE id=?', c.id).first())
      .delivered,
    1,
  );
  await h.recordImpression(p, {
    offerId: po.offerId,
    ratio: 1,
    visibleMs: 2000,
  });
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM ad_impressions WHERE campaign_id=?',
        c.id,
      ).first()
    ).n,
    1,
  );
});
void test('invoice reservation is atomic and replayed Lava callbacks provision exactly once', async () => {
  const g = await game(),
    c = await campaign(g.owner);
  await h.moderate(g.admin, {
    type: 'campaign',
    id: c.id,
    action: 'approve',
    reason: 'Approved test campaign.',
  });
  Object.assign(h.env, {
    BILLING_ENABLED: 'true',
    LAVA_API_KEY: 'test-only',
    LAVA_OFFER_ID: 'test-offer',
    LAVA_WEBHOOK_TOKEN: 'test-hook',
  });
  let invoiceCalls = 0;
  const externalId = `test-invoice-${++serial}`;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://gate.lava.top/api/v3/invoice');
    assert.equal(JSON.parse(options.body).amount, 10);
    invoiceCalls++;
    await new Promise((resolve) => setImmediate(resolve));
    return Response.json({
      id: externalId,
      paymentUrl: 'https://app.lava.top/test-only',
    });
  };
  const results = await Promise.allSettled([
    h.checkoutCampaign(g.owner, { campaignId: c.id, provider: 'lava' }),
    h.checkoutCampaign(g.owner, { campaignId: c.id, provider: 'lava' }),
  ]);
  assert.equal(invoiceCalls, 1);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const send = (type, status) =>
    h.handleWebhook(
      'lava',
      new Request('https://findnewgame.example/api/webhooks/lava', {
        method: 'POST',
        headers: { 'X-Api-Key': 'test-hook' },
        body: JSON.stringify({
          contractId: externalId,
          eventType: type,
          status,
          amount: 10,
          currency: 'USD',
        }),
      }),
    );
  await Promise.all([
    send('payment.success', 'completed'),
    send('payment.success', 'completed'),
  ]);
  await send('payment.failed', 'failed');
  const paid = await sql(
    'SELECT paid_impressions,payment_status FROM ad_campaigns WHERE id=?',
    c.id,
  ).first();
  assert.equal(paid.paid_impressions, 1000);
  assert.equal(paid.payment_status, 'paid');
  await assert.rejects(
    h.handleWebhook(
      'lava',
      new Request('https://findnewgame.example/api/webhooks/lava', {
        method: 'POST',
        body: '{}',
      }),
    ),
    rejection(401),
  );
});
void test('Tribute donations deduplicate and verified purchases reconcile once with refunds terminal', async () => {
  h.env.TRIBUTE_API_KEY = 'test-tribute-only';
  const donation = {
    name: 'new_donation',
    created_at: '2026-08-31T10:00:00Z',
    payload: { donation_request_id: 99, amount: 350, currency: 'usd' },
  };
  await tribute({ ...donation, sent_at: '2026-08-31T10:00:01Z' });
  await tribute({ ...donation, sent_at: '2026-08-31T10:10:00Z' });
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM donations WHERE amount_cents=350',
      ).first()
    ).n,
    1,
  );
  const g = await game(),
    c = await campaign(g.owner),
    payload = { purchase_id: 100000 + serial, amount: 1000, currency: 'usd' },
    event = {
      name: 'new_digital_product',
      created_at: '2026-08-31T11:00:00Z',
      payload,
    };
  await tribute(event);
  const payment = await sql(
    'SELECT id,provisioned_at FROM payments WHERE external_payment_id=?',
    `purchase:${payload.purchase_id}`,
  ).first();
  assert.equal(payment.provisioned_at, null);
  await assert.rejects(
    h.reconcilePurchase(g.admin, {
      paymentId: payment.id,
      campaignId: c.id,
      reason: 'short',
    }),
    rejection(400),
  );
  await h.reconcilePurchase(g.admin, {
    paymentId: payment.id,
    campaignId: c.id,
    reason: 'Buyer and campaign verified in this isolated fixture.',
  });
  await assert.rejects(
    h.reconcilePurchase(g.admin, {
      paymentId: payment.id,
      campaignId: c.id,
      reason: 'Duplicate attempt must not provision twice.',
    }),
    rejection(409),
  );
  assert.equal(
    (
      await sql(
        'SELECT paid_impressions FROM ad_campaigns WHERE id=?',
        c.id,
      ).first()
    ).paid_impressions,
    1000,
  );
  await tribute({ ...event, name: 'digital_product_refund' });
  await tribute(event);
  assert.equal(
    (await sql('SELECT status FROM payments WHERE id=?', payment.id).first())
      .status,
    'refunded',
  );
  assert.equal(
    (await sql('SELECT status FROM ad_campaigns WHERE id=?', c.id).first())
      .status,
    'paused',
  );
});
void test('image uploads deduplicate by owner and content, reject unsafe types, and remain private before publication', async () => {
  const owner = await user(),
    other = await user(),
    bytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
        'base64',
      ),
    );
  const request = () =>
    new Request('https://findnewgame.example/api/assets/upload', {
      method: 'POST',
      body: bytes,
    });
  const a = await h.uploadImage(owner, request()),
    b = await h.uploadImage(owner, request());
  assert.equal(a.reference, b.reference);
  assert.equal(b.deduplicated, true);
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM uploads WHERE owner_user_id=?',
        owner.id,
      ).first()
    ).n,
    1,
  );
  assert.equal(
    (await h.uploadedAsset(owner, a.reference.slice(3))).status,
    200,
  );
  await assert.rejects(
    h.uploadedAsset(other, a.reference.slice(3)),
    rejection(404),
  );
  await assert.rejects(
    h.uploadImage(
      owner,
      new Request('https://findnewgame.example/api/assets/upload', {
        method: 'POST',
        body: '<svg><script>alert(1)</script></svg>',
      }),
    ),
    rejection(415),
  );
});
void test('CSRF and rate limits reject cross-site writes and bursts with hashed persistent keys', async () => {
  assert.throws(
    () =>
      h.assertSameOrigin(
        new Request('https://findnewgame.example/api/profile', {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'x-fng-request': '1' },
        }),
      ),
    rejection(403),
  );
  assert.throws(
    () =>
      h.assertSameOrigin(
        new Request('https://findnewgame.example/api/profile', {
          method: 'POST',
        }),
      ),
    rejection(403),
  );
  const responses = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      h.rateLimit(`test-limit-${serial}`, 3, 60000),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 'fulfilled').length, 3);
  const stored = await sql('SELECT key FROM rate_limits').all();
  assert.ok(stored.results.every((r) => /^[a-f0-9]{64}$/.test(r.key)));
  assert.throws(
    () =>
      h.safeUrl(
        'https://shared.fastly.steamstatic.com:1234/image.jpg',
        'Image',
        ['shared.fastly.steamstatic.com'],
      ),
    rejection(400),
  );
});
void test('account deletion cascades personal history and withdraws games without deleting payment records', async () => {
  const g = await game(),
    day = await h.dailyFor(g.owner);
  await finishRound(g.owner, day.slots[0].id, g.body.targets);
  const paymentId = `test-retained-${++serial}`;
  await sql(
    "INSERT INTO payments (id,user_id,provider,purpose,amount_cents,currency,status,created_at) VALUES (?,?,'tribute','donation',100,'USD','paid',?)",
    paymentId,
    g.owner.id,
    Date.now(),
  ).run();
  await h.deleteAccount(g.owner, { confirmation: 'DELETE' });
  assert.equal(
    await sql('SELECT id FROM users WHERE id=?', g.owner.id).first(),
    null,
  );
  assert.equal(
    (
      await sql(
        'SELECT COUNT(*) n FROM quiz_final_results WHERE user_id=?',
        g.owner.id,
      ).first()
    ).n,
    0,
  );
  assert.equal(
    (await sql('SELECT status FROM games WHERE id=?', g.id).first()).status,
    'withdrawn',
  );
  assert.equal(
    (await sql('SELECT user_id FROM payments WHERE id=?', paymentId).first())
      .user_id,
    null,
  );
});
