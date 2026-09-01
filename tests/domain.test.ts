import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { CONFIG, EMPTY_TASTE } from '../lib/config.ts';
import {
  buildUserVector,
  cosine,
  computeRarity,
  selectDaily,
} from '../lib/recommendation.ts';
import {
  availableStages,
  clueStageFor,
  scoreGuess,
  spoilerFreeShare,
} from '../lib/scoring.ts';
import {
  localDate,
  nextLocalMidnight,
  streaks,
  validTimezone,
} from '../lib/time.ts';
import { matchesAudience, pacingAllowance } from '../lib/advertising.ts';
import {
  normalizeLavaEvent,
  normalizeTributeEvent,
  verifyTributeSignature,
} from '../lib/payment-contracts.ts';
import { belongsToGroup } from '../lib/tag-groups.ts';
import type { CandidateGame, GameContent, SteamTag } from '../lib/types.ts';
const tags = JSON.parse(
  readFileSync(new URL('../data/steam_tags.json', import.meta.url), 'utf8'),
) as SteamTag[];
const sample = JSON.parse(
  readFileSync(new URL('../data/demo_games.json', import.meta.url), 'utf8'),
)[0] as GameContent;
void test('every sample uses unique canonical tags in the correct quiz group and English materials', () => {
  const catalog = JSON.parse(
    readFileSync(new URL('../data/demo_games.json', import.meta.url), 'utf8'),
  ) as GameContent[];
  assert.equal(catalog.length, 20);
  assert.equal(
    new Set(catalog.map((game) => game.steamAppId)).size,
    catalog.length,
  );
  assert.ok(!/[А-Яа-яЁё]/.test(JSON.stringify(catalog)));
  assert.ok(
    tags.every((tag) => Object.keys(tag.localizations_json).length === 0),
  );
  assert.equal(catalog.filter((game) => game.officialUrl !== null).length, 18);
  for (const game of catalog) {
    if (game.officialUrl)
      assert.equal(new URL(game.officialUrl).protocol, 'https:');
    assert.equal(new Set(game.screenshots).size, game.screenshots.length);
    assert.equal(new Set(game.tagIds).size, game.tagIds.length);
    for (const group of ['genre', 'core', 'mood'] as const) {
      assert.ok(game.targets[group].length <= CONFIG.maxGuessTagsPerGroup);
      assert.equal(
        new Set(game.targets[group]).size,
        game.targets[group].length,
      );
      for (const id of game.targets[group]) {
        const target = tags.find((tag) => tag.id === id);
        assert.ok(
          target && belongsToGroup(target, group),
          `${game.title}: ${id} belongs in ${group}`,
        );
        assert.ok(game.tagIds.includes(id));
      }
    }
  }
});
const tag = (name: string) => {
  const found = tags.find((t) => t.steam_name === name);
  assert.ok(found, `${name} exists in the canonical catalog`);
  return found.id;
};
function game(index: number): CandidateGame {
  return {
    id: `g-${index}`,
    developerId: `d-${index}`,
    publisherKey: `p-${index}`,
    familyKey: `f-${index}`,
    versionId: `v-${index}`,
    content: { ...sample, tagIds: [tag('Adventure'), tag('Exploration')] },
    status: 'published',
    qualifiedImpressions: 0,
    isDemo: false,
  };
}
function rng(seed = 17) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
void test('canonical taxonomy has unique Steam IDs/slugs and English names', () => {
  assert.ok(tags.length >= 400);
  assert.equal(new Set(tags.map((t) => t.id)).size, tags.length);
  assert.equal(new Set(tags.map((t) => t.slug)).size, tags.length);
  assert.ok(tags.every((t) => !/[А-Яа-яЁё]/.test(t.steam_name)));
});
void test('curated fighting and shooter subgenres participate in genre picking and strict exclusions', () => {
  for (const name of [
    '2D Fighter',
    '3D Fighter',
    'Top-Down Shooter',
    'Arena Shooter',
    'Traditional Roguelike',
  ]) {
    const id = tag(name),
      entry = tags.find((t) => t.id === id)!;
    assert.equal(belongsToGroup(entry, 'genre'), true);
    const candidate = game(0);
    candidate.content.tagIds = [id, tag('Combat')];
    const result = selectDaily({
      games: [candidate],
      tags,
      taste: { ...EMPTY_TASTE, hardNo: [id] },
      seenGameIds: new Set(),
    });
    assert.equal(result.games.length, 0);
  }
});
void test('a full, correct target earns the published score at all four stages', () => {
  for (let stage = 1; stage <= CONFIG.stageNames.length; stage++) {
    const result = scoreGuess(
      { ...sample.targets, wouldClick: 'yes' },
      sample.targets,
      stage,
      tags,
    );
    assert.equal(result.score, CONFIG.stagePoints[stage - 1]);
    assert.equal(result.accuracy, 100);
  }
});
void test('extra guesses cannot increase a match; guessing nothing earns zero', () => {
  const exact = scoreGuess(
    { ...sample.targets, wouldClick: 'yes' },
    sample.targets,
    1,
    tags,
  );
  const extra = scoreGuess(
    {
      ...sample.targets,
      genre: [...sample.targets.genre, tag('FPS')],
      wouldClick: 'no',
    },
    sample.targets,
    1,
    tags,
  );
  assert.ok(extra.score < exact.score);
  assert.equal(
    scoreGuess(
      { genre: [], core: [], mood: [], wouldClick: null },
      sample.targets,
      1,
      tags,
    ).score,
    0,
  );
});
void test('intention does not change the quiz score and optional empty targets are normalized', () => {
  const target = {
    genre: [tag('Adventure')],
    core: [tag('Exploration')],
    mood: [],
  };
  assert.equal(
    scoreGuess({ ...target, wouldClick: 'no' }, target, 2, tags).score,
    800,
  );
  assert.equal(
    scoreGuess({ ...target, wouldClick: 'yes' }, target, 2, tags).score,
    800,
  );
});
void test('the single trailer stage is skipped when no verified video exists', () => {
  const withoutVideo = { ...sample, youtubeId: null };
  assert.deepEqual(availableStages(withoutVideo), [1, 2, 3]);
  assert.equal(clueStageFor(withoutVideo, 6), 3);
  assert.deepEqual(
    availableStages({ ...sample, youtubeId: 'BrRWb7tFxR8' }),
    [1, 2, 3, 4],
  );
  assert.equal(clueStageFor(sample, 6), 4);
});
void test('explicit dislikes override bounded behavioral feedback', () => {
  const genre = tag('Adventure'),
    mechanic = tag('Exploration');
  const vector = buildUserVector(
    { ...EMPTY_TASTE, genres: [genre], hardNo: [mechanic] },
    tags,
    { [genre]: 1000, [mechanic]: 1000 },
  );
  assert.equal(vector.get(genre), 5.5);
  assert.equal(vector.get(mechanic), -5);
});
void test('cosine handles empty and opposing vectors and rarity remains bounded', () => {
  assert.equal(cosine(new Map(), new Map([[1, 1]])), 0);
  assert.equal(cosine(new Map([[1, 1]]), new Map([[1, -1]])), -1);
  const rarity = computeRarity(Array.from({ length: 20 }, (_, i) => game(i)));
  assert.ok([...rarity.values()].every((x) => x >= 0.2 && x <= 2));
});
void test('daily selection preserves unseen, family, developer, publisher, and hard-no constraints', () => {
  const games = Array.from({ length: 12 }, (_, i) => game(i));
  games[1].developerId = games[0].developerId;
  games[2].publisherKey = games[0].publisherKey;
  games[3].familyKey = games[0].familyKey;
  games[4].content.tagIds = [tag('Horror')];
  for (let seed = 1; seed < 80; seed++) {
    const result = selectDaily({
      games,
      tags,
      taste: { ...EMPTY_TASTE, hardNo: [tag('Horror')] },
      seenGameIds: new Set(['g-5']),
      seenFamilyKeys: new Set(['f-6']),
      random: rng(seed),
    }).games;
    assert.equal(result.length, 3);
    assert.equal(new Set(result.map((g) => g.developerId)).size, 3);
    assert.equal(new Set(result.map((g) => g.publisherKey)).size, 3);
    assert.equal(new Set(result.map((g) => g.familyKey)).size, 3);
    assert.ok(result.every((g) => !['g-4', 'g-5', 'g-6'].includes(g.id)));
  }
});
void test('a small catalog returns a shortage instead of repeating or weakening hard exclusions', () => {
  const games = [game(0), game(1)];
  assert.equal(
    selectDaily({
      games,
      tags,
      taste: EMPTY_TASTE,
      seenGameIds: new Set(['g-0', 'g-1']),
    }).games.length,
    0,
  );
  assert.equal(
    selectDaily({
      games,
      tags,
      taste: { ...EMPTY_TASTE, hardNo: [tag('Adventure')] },
      seenGameIds: new Set(),
    }).games.length,
    0,
  );
});
void test('retests require changed materials and the full 14-day cooldown', () => {
  const current = Date.parse('2026-08-31T12:00:00Z'),
    candidate = game(0);
  const run = () =>
    selectDaily({
      games: [candidate],
      tags,
      taste: EMPTY_TASTE,
      seenGameIds: new Set([candidate.id]),
      now: current,
    }).games.length;
  candidate.retest = {
    experimentId: 'e',
    changedPresentation: true,
    previousExposureAt: current - 13 * 86400000,
  };
  assert.equal(run(), 0);
  candidate.retest.previousExposureAt = current - 14 * 86400000;
  assert.equal(run(), 1);
  candidate.retest.changedPresentation = false;
  assert.equal(run(), 0);
});
void test('relevant sampling is stochastic and reduces dominance by overexposed games', () => {
  const games = Array.from({ length: 12 }, (_, i) => game(i));
  games[0].qualifiedImpressions = 400;
  const counts = new Map<string, number>(),
    random = rng();
  for (let i = 0; i < 1200; i++)
    for (const g of selectDaily({
      games,
      tags,
      taste: EMPTY_TASTE,
      seenGameIds: new Set(),
      random,
    }).games)
      counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
  assert.equal(counts.size, 12);
  assert.ok(counts.get('g-1')! > counts.get('g-0')! * 4);
});
void test('reset is the exact next local midnight across DST and quarter-hour time zones', () => {
  for (const [now, zone, expected] of [
    ['2026-03-08T05:00:00Z', 'America/New_York', '2026-03-09T04:00:00Z'],
    ['2026-11-01T04:00:00Z', 'America/New_York', '2026-11-02T05:00:00Z'],
    ['2026-08-31T10:00:00Z', 'Asia/Kathmandu', '2026-08-31T18:15:00Z'],
    ['2026-08-31T20:59:59.999Z', 'Europe/Moscow', '2026-08-31T21:00:00Z'],
  ])
    assert.equal(
      nextLocalMidnight(Date.parse(now), zone),
      Date.parse(expected),
    );
  assert.equal(
    localDate(Date.parse('2026-08-31T21:01:00Z'), 'Europe/Moscow'),
    '2026-09-01',
  );
  assert.equal(validTimezone('Mars/Base'), false);
});
void test('streaks use complete local dates, not score or duplicate records', () => {
  assert.deepEqual(
    streaks(['2026-08-29', '2026-08-30', '2026-08-30'], '2026-08-31'),
    { current: 2, best: 2 },
  );
  assert.deepEqual(streaks(['2026-08-29'], '2026-08-31'), {
    current: 0,
    best: 1,
  });
  assert.deepEqual(streaks(['2026-08-30', '2026-08-31'], '2026-08-31'), {
    current: 2,
    best: 2,
  });
});
void test('spoiler-free shares contain scores but no target tags or game title', () => {
  const text = spoilerFreeShare('2026-08-31', [
    { score: 650, accuracy: 100, stage: 3 },
  ]);
  assert.ok(text.includes('650 points'));
  assert.ok(text.includes('1/3 games'));
  assert.equal(Array.from(text.split('\n')[1]).length, 4);
  assert.ok(!text.includes(sample.title));
  assert.ok(!text.includes('Adventure'));
});
void test('advertising exclusions win and at-least-N targeting counts distinct interests', () => {
  const target = {
    include: [1, 2, 3],
    exclude: [4],
    mode: 'at_least_n' as const,
    minimum: 2,
  };
  assert.equal(matchesAudience(new Set([1, 2]), target), true);
  assert.equal(matchesAudience(new Set([1]), target), false);
  assert.equal(matchesAudience(new Set([1, 2, 4]), target), false);
});
void test('pacing caps the cumulative day allocation and never serves outside the window', () => {
  const start = 1000,
    end = start + 10 * 86400000;
  assert.equal(pacingAllowance(1000, start, end, start - 1), 0);
  assert.equal(pacingAllowance(1000, start, end, start + 1000), 100);
  assert.equal(pacingAllowance(1000, start, end, start + 4 * 86400000), 500);
  assert.ok(pacingAllowance(1000, start, end, end - 1) <= 1000);
  assert.equal(pacingAllowance(1000, start, end, end), 0);
});
void test('Lava uses major units while Tribute uses integer minor units', async () => {
  assert.equal(
    normalizeLavaEvent({
      eventType: 'payment.success',
      status: 'completed',
      contractId: 'contract',
      amount: 12.34,
      currency: 'USD',
    }).amountCents,
    1234,
  );
  const event = await normalizeTributeEvent({
    name: 'new_digital_product',
    created_at: '2026-08-31T10:00:00Z',
    payload: { purchase_id: 7, amount: 1234, currency: 'usd' },
  });
  assert.equal(event.amountCents, 1234);
  assert.equal(event.externalPaymentId, 'purchase:7');
});
void test('Tribute retries changing sent_at retain the same idempotency key', async () => {
  const data = {
    name: 'new_donation',
    created_at: '2026-08-31T10:00:00Z',
    payload: { donation_request_id: 4, amount: 200, currency: 'usd' },
  };
  const a = await normalizeTributeEvent({
      ...data,
      sent_at: '2026-08-31T10:01:00Z',
    }),
    b = await normalizeTributeEvent({
      ...data,
      sent_at: '2026-08-31T10:05:00Z',
    });
  assert.equal(a.eventKey, b.eventKey);
  const different = await normalizeTributeEvent({
    ...data,
    created_at: '2026-08-31T10:10:00Z',
  });
  assert.notEqual(a.externalPaymentId, different.externalPaymentId);
});
void test('Tribute signatures cover the exact raw body and reject tampering', async () => {
  const raw = '{"amount":1234}',
    key = 'test-secret-only';
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(raw)),
  ).toString('hex');
  assert.equal(await verifyTributeSignature(raw, signature, key), true);
  assert.equal(await verifyTributeSignature(raw + ' ', signature, key), false);
  assert.equal(await verifyTributeSignature(raw, signature, 'wrong'), false);
  assert.equal(await verifyTributeSignature(raw, 'malformed', key), false);
});
