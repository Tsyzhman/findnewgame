import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(
  process.argv.length,
  2,
  'The concurrency check accepts no remote target or options.',
);
process.env.WRANGLER_SEND_METRICS = 'false';
process.env.WRANGLER_WRITE_LOGS = 'false';
const { createTestHarness } = await import('wrangler');
const configPath = new URL('../dist/server/wrangler.json', import.meta.url);
const config = JSON.parse(await readFile(configPath, 'utf8'));
assert.ok(
  [...(config.d1_databases ?? []), ...(config.r2_buckets ?? [])].every(
    (binding) => binding.remote !== true,
  ),
  'Remote storage bindings are prohibited.',
);
const server = createTestHarness({
  workers: [
    {
      configPath,
      vars: { CATALOG_MODE: 'demo', BILLING_ENABLED: 'false' },
      secrets: {
        TURNSTILE_SECRET_KEY: '',
        LAVA_API_KEY: '',
        LAVA_WEBHOOK_TOKEN: '',
        TRIBUTE_API_KEY: '',
        ADMIN_EMAILS: '',
      },
    },
  ],
});
const report = {
  date: new Date().toISOString(),
  status: 'running',
  transport:
    'Cloudflare native Worker entrypoint with isolated local D1; no network proxy or Sites gateway.',
  syntheticSessions: 8,
  maximumInFlightRequests: 16,
  phases: [],
  productionCapacityVerified: false,
  limitations: [
    'A bounded functional concurrency check on this machine, not a distributed load test or production latency SLA.',
    'Uses the bundled sample catalog and expiring anonymous sessions; no real accounts, studio rights or payments are created.',
    'Does not cover static asset routing, merchant callbacks, browser rendering, or hosted identity.',
  ],
};
const timings = [];
const started = performance.now();
let worker, origin;

async function mapLimit(items, run) {
  const output = Array.from({ length: items.length });
  let next = 0;
  const tasks = Array.from(
    { length: Math.min(report.maximumInFlightRequests, items.length) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        output[index] = await run(items[index], index);
      }
    },
  );
  // Drain other in-flight requests before surfacing a failure and closing D1.
  const settled = await Promise.allSettled(tasks);
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return output;
}

async function call(route, body, session, headers = {}) {
  const start = performance.now();
  const response = await worker.fetch(`${origin}/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-fng-request': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { cookie: session.cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  const data = JSON.parse(text);
  timings.push({
    route: route.split('/')[0].split('?')[0],
    status: response.status,
    ms: performance.now() - start,
  });
  return { response, data };
}

async function phase(name, action) {
  const start = performance.now();
  const value = await action();
  report.phases.push({
    name,
    passed: true,
    ms: Math.round(performance.now() - start),
  });
  console.log(`PASS ${name}`);
  return value;
}

try {
  origin = (await server.listen()).url.origin;
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  worker = server.getWorker();
  const { DB: db } = await worker.getEnv();
  assert.equal(
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='users'",
      )
      .first(),
    null,
    'The compiled harness must start with a new empty database.',
  );
  const journal = JSON.parse(
    await readFile(
      new URL('../drizzle/meta/_journal.json', import.meta.url),
      'utf8',
    ),
  );
  const sessions = await phase(
    'Concurrent cold-start sessions initialize the complete migration ledger',
    async () => {
      const created = await mapLimit(
        Array.from({ length: report.syntheticSessions }),
        async () => {
          const { response, data } = await call('demo', {});
          assert.equal(response.status, 200, JSON.stringify(data));
          assert.equal(data.user.isDemo, true);
          assert.equal(
            data.user.isLocal,
            false,
            'Compiled code must not use the development identity.',
          );
          const cookie = response.headers.get('set-cookie')?.split(';')[0];
          assert.ok(cookie?.startsWith('fng_demo='));
          return { cookie, userId: data.user.id };
        },
      );
      const versions = (
        await db
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
      ).results.map((row) => row.version);
      assert.deepEqual(
        versions.filter((version) => /^\d{4}$/.test(version)),
        journal.entries.map((entry) => entry.tag.slice(0, 4)),
      );
      assert.equal(
        versions.filter((version) =>
          /^demo-catalog-[a-f0-9]{16}$/.test(version),
        ).length,
        1,
      );
      return created;
    },
  );
  const dailySets = await phase(
    '128 Daily requests with up to 16 in flight freeze one three-slot set per session',
    async () => {
      const calls = Array.from({ length: 16 }, () =>
        sessions.map((session, sessionIndex) => ({ session, sessionIndex })),
      ).flat();
      const replies = await mapLimit(
        calls,
        async ({ session, sessionIndex }) => {
          const reply = await call('daily?demo=1', {}, session);
          assert.equal(reply.response.status, 200, JSON.stringify(reply.data));
          assert.equal(reply.data.slots.length, 3);
          return { sessionIndex, data: reply.data };
        },
      );
      return sessions.map((_, index) => {
        const matching = replies
          .filter((reply) => reply.sessionIndex === index)
          .map((reply) => reply.data);
        assert.equal(new Set(matching.map((daily) => daily.id)).size, 1);
        const slots = matching[0].slots.map((slot) => slot.id);
        for (const daily of matching)
          assert.deepEqual(
            daily.slots.map((slot) => slot.id),
            slots,
          );
        return matching[0];
      });
    },
  );
  const frozen = async () => ({
    sets: (
      await db
        .prepare(
          'SELECT id,user_id,local_date,timezone,reset_at,algorithm_version,selection_json FROM daily_sets ORDER BY id',
        )
        .all()
    ).results,
    assignments: (
      await db
        .prepare(
          'SELECT id,set_id,user_id,slot,game_id,developer_id,publisher_key,family_key,version_id,variant_id FROM daily_assignments ORDER BY id',
        )
        .all()
    ).results,
  });
  const before = await frozen();
  assert.equal(before.sets.length, sessions.length);
  assert.equal(before.assignments.length, sessions.length * 3);
  for (const set of before.sets) {
    const slots = before.assignments.filter((slot) => slot.set_id === set.id);
    for (const key of ['slot', 'developer_id', 'publisher_key', 'family_key'])
      assert.equal(new Set(slots.map((slot) => slot[key])).size, 3, key);
  }
  await phase(
    'Concurrent sessions cannot read another player’s unrevealed round',
    async () => {
      const reply = await call(
        `round/${dailySets[0].slots[0].id}?demo=1`,
        undefined,
        sessions[1],
      );
      assert.equal(reply.response.status, 404);
      assert.equal(reply.data.result, undefined);
    },
  );
  const rounds = dailySets.flatMap((daily, index) =>
    daily.slots.map((slot) => ({ id: slot.id, session: sessions[index] })),
  );
  const tagsReply = await call('tags');
  assert.equal(tagsReply.response.status, 200);
  const tagId = (name) => {
    const tag = tagsReply.data.tags.find((tag) => tag.steam_name === name);
    assert.ok(tag, name);
    return tag.id;
  };
  const guess = {
    stage: 1,
    action: 'lock',
    genre: [tagId('Adventure')],
    core: [tagId('Exploration')],
    mood: [],
    wouldClick: 'maybe',
  };
  await phase(
    'Repeated concurrent finalization produces one result per round and completes all three slots',
    async () => {
      await mapLimit(rounds, async (round) => {
        const reply = await call(
          `round/${round.id}/start?demo=1`,
          {},
          round.session,
        );
        assert.equal(reply.response.status, 200);
        assert.equal(reply.data.result, null);
      });
      await delay(850); // Respect the real clue timer; do not disable the guard.
      const replies = await mapLimit(
        rounds.flatMap((round) => [round, round, round]),
        async (round) => {
          const reply = await call(
            `round/${round.id}/guess?demo=1`,
            guess,
            round.session,
          );
          assert.equal(reply.response.status, 200, JSON.stringify(reply.data));
          assert.equal(reply.data.status, 'complete');
          return { id: round.id, result: reply.data.result };
        },
      );
      for (const round of rounds) {
        const matches = replies.filter((reply) => reply.id === round.id);
        for (const reply of matches)
          assert.deepEqual(reply.result, matches[0].result);
      }
      assert.equal(
        await db
          .prepare('SELECT COUNT(*) n FROM quiz_final_results')
          .first('n'),
        rounds.length,
      );
      assert.equal(
        await db
          .prepare('SELECT COUNT(*) n FROM quiz_stage_guesses')
          .first('n'),
        rounds.length,
      );
      assert.equal(
        await db
          .prepare(
            'SELECT COUNT(*) n FROM quiz_final_results WHERE qualified=1',
          )
          .first('n'),
        0,
      );
      assert.equal(
        await db
          .prepare(
            'SELECT COUNT(*) n FROM daily_sets WHERE completed_at IS NOT NULL',
          )
          .first('n'),
        sessions.length,
      );
      await mapLimit(sessions, async (session, index) => {
        const reply = await call('daily?demo=1', {}, session);
        assert.equal(reply.response.status, 200);
        assert.equal(reply.data.id, dailySets[index].id);
        assert.ok(reply.data.slots.every((slot) => slot.status === 'complete'));
      });
      assert.deepEqual(
        await frozen(),
        before,
        'Finishing must not rewrite the assigned games, versions, or selection records.',
      );
    },
  );
  await phase(
    'A bounded excess burst is rate-limited without corrupting assignments or stopping the Worker',
    async () => {
      const burstStarted = Date.now();
      const replies = await mapLimit(Array.from({ length: 64 }), () =>
        call('daily?demo=1', {}, sessions[0]),
      );
      assert.ok(
        Date.now() - burstStarted < 60000,
        'This bounded burst exceeded its observation window.',
      );
      assert.ok(
        replies.every((reply) => [200, 429].includes(reply.response.status)),
      );
      const limited = replies.filter((reply) => reply.response.status === 429);
      assert.ok(
        limited.length > 0,
        'More than two rate-limit windows of requests must not all be accepted in less than one minute.',
      );
      assert.ok(limited.every((reply) => reply.data.code === 'rate_limited'));
      report.rateLimitedResponses = limited.length;
      assert.deepEqual(await frozen(), before);
      const rejected = await call('demo', {}, undefined, {
        origin: 'https://invalid.example',
      });
      assert.equal(rejected.response.status, 403);
      const health = await call('health');
      assert.equal(health.response.status, 200);
      assert.equal(health.data.status, 'ok');
    },
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  report.verifiedState = {
    users: sessions.length,
    dailySets: before.sets.length,
    assignments: before.assignments.length,
    completedRounds: rounds.length,
    stageGuesses: rounds.length,
    qualifiedLiveResults: 0,
  };
  await phase(
    'Startup accepts the complete schema when a platform migration runner applied it first',
    async () => {
      await server.reset();
      origin = (await server.listen()).url.origin;
      worker = server.getWorker();
      const { DB: preapplied } = await worker.getEnv();
      for (const entry of journal.entries) {
        assert.match(entry.tag, /^\d{4}_[a-z_]+$/);
        const source = await readFile(
          new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
          'utf8',
        );
        const statements = source
          .split('--> statement-breakpoint')
          .map((part) => part.trim())
          .filter(Boolean);
        await preapplied.batch(
          statements.map((sql) => preapplied.prepare(sql)),
        );
      }
      const health = await call('health');
      assert.equal(health.response.status, 200, JSON.stringify(health.data));
      const versions = (
        await preapplied
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
      ).results.map((row) => row.version);
      assert.deepEqual(
        versions.filter((version) => /^\d{4}$/.test(version)),
        journal.entries.map((entry) => entry.tag.slice(0, 4)),
      );
      assert.deepEqual(
        (await preapplied.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
    },
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  // Keep a narrowly scoped database error, never raw proxy/runtime diagnostics.
  report.migrationDiagnostic =
    JSON.stringify(server.getLogs()).match(
      /duplicate column name: [a-z0-9_]+/i,
    )?.[0] ?? null;
  process.exitCode = 1;
  console.error(`FAIL ${error.message}`);
} finally {
  try {
    await server.close();
    report.runtimeClosed = true;
  } catch (error) {
    report.status = 'failed';
    report.runtimeClosed = false;
    report.cleanupError = error.message;
    process.exitCode = 1;
  }
  const groups = {};
  for (const route of new Set(timings.map((item) => item.route))) {
    const samples = timings
      .filter((item) => item.route === route)
      .map((item) => item.ms)
      .sort((a, b) => a - b);
    const percentile = (p) =>
      Math.round(samples[Math.ceil(samples.length * p) - 1] * 100) / 100;
    groups[route] = {
      requests: samples.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: percentile(1),
    };
  }
  report.requests = timings.length;
  report.requestTimings = groups;
  report.elapsedMs = Math.round(performance.now() - started);
  report.nodePeakRssBytes = process.resourceUsage().maxRSS * 1024;
  report.memoryScope =
    'Node orchestrator only; excludes the child workerd process and does not establish production memory.';
  await mkdir(new URL('../../artifacts/', import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL('../../artifacts/concurrency-smoke.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Concurrency check ${report.status}; ${report.requests} measured requests.`,
  );
}
