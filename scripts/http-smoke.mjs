import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.FNG_TEST_ORIGIN ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error(
    'The mutation smoke test only runs against a local instance.',
  );
const records = [];
let cookie = '';
async function call(path, body, options = {}) {
  const response = await fetch(`${origin}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-fng-request': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (response.headers.has('set-cookie'))
    cookie = response.headers.get('set-cookie').split(';')[0];
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }
  return { response, data };
}
async function check(name, run) {
  const start = performance.now();
  await run();
  records.push({
    name,
    passed: true,
    ms: Math.round(performance.now() - start),
  });
  console.log(`PASS ${name}`);
}
await check(
  'All public and protected-page shells render without server errors',
  async () => {
    for (const path of [
      '/',
      '/about',
      '/privacy',
      '/support',
      '/today',
      '/play?demo=1',
      '/onboarding',
      '/account',
      '/collection',
      '/history',
      '/developer',
      '/developer/games/new',
      '/developer/experiments',
      '/developer/ads',
      '/admin',
    ]) {
      const response = await fetch(origin + path, {
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.match(html, /<html[^>]*lang="en"/);
      assert.ok(
        !/[А-Яа-яЁё]/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')),
        `Rendered copy is English: ${path}`,
      );
    }
  },
);
await check(
  'Health and canonical taxonomy respond; anonymous account data is gated',
  async () => {
    assert.equal((await call('health')).data.status, 'ok');
    assert.ok((await call('tags')).data.tags.length >= 400);
    for (const route of [
      'history',
      'collection',
      'developer',
      'admin',
      'account/export',
    ])
      assert.equal((await call(route)).response.status, 401, route);
  },
);
await check(
  'Cross-site mutation is rejected before session creation',
  async () => {
    const { response } = await call(
      'demo',
      {},
      { headers: { origin: 'https://invalid.example' } },
    );
    assert.equal(response.status, 403);
  },
);
await check(
  'A fresh anonymous demo session gets a stable three-game set under concurrent requests',
  async () => {
    const demo = await call('demo', {});
    assert.equal(demo.response.status, 200);
    assert.ok(demo.data.user.isDemo);
    assert.ok(cookie.startsWith('fng_demo='));
    const sets = await Promise.all(
      Array.from({ length: 4 }, () => call('daily?demo=1', {})),
    );
    assert.ok(sets.every((s) => s.response.ok));
    assert.equal(new Set(sets.map((s) => s.data.id)).size, 1);
    assert.equal(sets[0].data.slots.length, 3);
  },
);
const daily = (await call('daily?demo=1', {})).data;
await check(
  'An unlocked clue image loads with a bounded image response',
  async () => {
    const id = daily.slots[0].id;
    await call(`round/${id}/start?demo=1`, {});
    const response = await fetch(`${origin}/api/round/${id}/asset/0?demo=1`, {
      headers: { cookie },
      signal: AbortSignal.timeout(25000),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /^image\/(jpeg|png|webp)/,
    );
    assert.ok((await response.arrayBuffer()).byteLength <= 3 * 1024 * 1024);
  },
);
await check(
  'A real HTTP round withholds the answer, rejects locked assets, and survives replay',
  async () => {
    const id = daily.slots[0].id,
      start = await call(`round/${id}/start?demo=1`, {});
    assert.equal(start.response.status, 200);
    assert.equal(start.data.result, null);
    assert.equal(start.data.youtubeId, null);
    assert.equal(start.data.description, null);
    const locked = await fetch(`${origin}/api/round/${id}/asset/3?demo=1`, {
      headers: { cookie },
    });
    assert.equal(locked.status, 403);
    await new Promise((resolve) => setTimeout(resolve, 850));
    const body = {
      stage: 1,
      action: 'clue',
      genre: [],
      core: [],
      mood: [],
      wouldClick: null,
    };
    const advanced = await call(`round/${id}/guess?demo=1`, body);
    assert.equal(advanced.data.stage, 2);
    const replay = await call(`round/${id}/guess?demo=1`, body);
    assert.equal(replay.response.status, 409);
    const strangers = await fetch(`${origin}/api/round/${id}`);
    assert.equal(strangers.status, 401);
  },
);
await check(
  'Local sign-in, authorized admin access, and a private account export work without editing preferences',
  async () => {
    const response = await fetch(
      `${origin}/signin-with-chatgpt?return_to=%2Faccount`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const ownCookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(ownCookie);
    const me = await fetch(`${origin}/api/me`, {
      headers: { cookie: ownCookie },
    }).then((r) => r.json());
    assert.equal(me.user.role, 'admin');
    const overview = await fetch(`${origin}/api/admin`, {
      headers: { cookie: ownCookie },
    });
    assert.equal(overview.status, 200);
    const exported = await fetch(`${origin}/api/account/export`, {
      headers: { cookie: ownCookie },
    });
    assert.equal(exported.status, 200);
    assert.match(
      exported.headers.get('content-disposition') ?? '',
      /attachment/,
    );
    assert.match(exported.headers.get('cache-control') ?? '', /no-store/);
    const data = await exported.json();
    assert.equal(data.profile.id, me.user.id);
    assert.ok(
      Array.isArray(data.preferences) &&
        Array.isArray(data.dailySets) &&
        data.activity,
    );
  },
);
await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../artifacts/http-smoke.json', import.meta.url),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      origin,
      checks: records,
      notice:
        'Quiz mutations affect only a newly-created, expiring anonymous session. Local authentication may refresh its activity timestamp. No merchant requests, existing preferences, game progress, or billing records were changed. Exported account data is not included in this report.',
    },
    null,
    2,
  ) + '\n',
);
console.log(`Verified ${records.length} request-level checks.`);
