import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  BANDIT,
  DEFAULT_DISCOVERY,
  discoveryProbabilities,
  fitLinearBandit,
  linearPrediction,
  parseDiscoverySettings,
  type BanditObservation,
  type DiscoveryPolicy,
} from '../lib/discovery-policy.ts';
import { selectDaily } from '../lib/recommendation.ts';
import type {
  CandidateGame,
  GameContent,
  SteamTag,
  TasteProfile,
} from '../lib/types.ts';

const tags = JSON.parse(
  readFileSync(new URL('../data/steam_tags.json', import.meta.url), 'utf8'),
) as SteamTag[];
const materials = JSON.parse(
  readFileSync(new URL('../data/demo_games.json', import.meta.url), 'utf8'),
) as GameContent[];
const games: CandidateGame[] = materials.map((content, i) => ({
  id: `policy-game-${i}`,
  developerId: `policy-studio-${i}`,
  publisherKey: `publisher-${i}`,
  familyKey: `family-${i}`,
  versionId: `version-${i}`,
  status: 'published',
  isDemo: false,
  qualifiedImpressions: 0,
  content,
}));
const tag = (name: string) =>
  tags.find((candidate) => candidate.steam_name === name)!.id;
const taste: TasteProfile = {
  genres: [tag('Adventure'), tag('Strategy'), tag('RPG')],
  mechanics: [tag('Exploration')],
  moods: [],
  hardNo: [tag('FPS')],
  discoveryMode: 'curious',
};
const bias = [1, 0, 0, 0, 0, 0, 0, 0];
const observations = (length: number): BanditObservation[] =>
  Array.from({ length }, (_, i) => ({
    features: [1, i % 2, 0.5, 0.2, 0, 0, 0, 0],
    reward: i % 2 ? 1 : 0,
  }));

void test('ridge learning matches the closed-form intercept and reduces uncertainty with observations', () => {
  const one = fitLinearBandit([{ features: bias, reward: 1 }]),
    ten = fitLinearBandit(
      Array.from({ length: 10 }, () => ({ features: bias, reward: 1 })),
    );
  assert.ok(Math.abs(linearPrediction(one, bias).mean - 0.5) < 1e-12);
  assert.ok(Math.abs(linearPrediction(ten, bias).mean - 10 / 11) < 1e-12);
  assert.ok(
    Math.abs(linearPrediction(ten, bias).uncertainty - 1 / Math.sqrt(11)) <
      1e-12,
  );
  assert.ok(
    linearPrediction(ten, [1, 1, 0, 0, 0, 0, 0, 0]).uncertainty >
      linearPrediction(ten, bias).uncertainty,
  );
});
void test('linear context distinguishes positive and negative affinity without unobserved negative examples', () => {
  const model = fitLinearBandit(observations(40));
  assert.equal(model.samples, 40);
  assert.equal(model.positives, 20);
  assert.equal(model.negatives, 20);
  assert.ok(linearPrediction(model, [1, 1, 0.5, 0.2, 0, 0, 0, 0]).mean > 0.8);
  assert.ok(linearPrediction(model, [1, 0, 0.5, 0.2, 0, 0, 0, 0]).mean < 0.15);
});
void test('learning rejects invalid contexts and stays bounded with redundant observations', () => {
  const model = fitLinearBandit([
    { features: [1, NaN, 0, 0, 0, 0, 0, 0], reward: 1 },
    { features: [0, 1, 0, 0, 0, 0, 0, 0], reward: 1 },
    { features: [1], reward: 1 },
    ...observations(500),
  ]);
  assert.equal(model.samples, BANDIT.maximumSamples);
  assert.ok(model.theta.every(Number.isFinite));
  assert.ok(model.inverse.flat().every(Number.isFinite));
  assert.throws(() => linearPrediction(model, [1]));
});
void test('MMR favors less redundant games and keeps organic exposure fairness and a positive probability', () => {
  const probabilities = discoveryProbabilities(
    [
      { relevance: 0.7, redundancy: 0.9, impressions: 0 },
      { relevance: 0.7, redundancy: 0.1, impressions: 0 },
      { relevance: 0.7, redundancy: 0.1, impressions: 99 },
    ],
    0.6,
  );
  assert.ok(probabilities[1] > probabilities[0]);
  assert.ok(Math.abs(probabilities[1] / probabilities[2] - 10) < 1e-10);
  assert.ok(probabilities.every((probability) => probability > 0));
  assert.ok(Math.abs(probabilities.reduce((sum, n) => sum + n, 0) - 1) < 1e-12);
  const onlyRelevance = discoveryProbabilities(
    [
      { relevance: 0.7, redundancy: 0.9, impressions: 0 },
      { relevance: 0.7, redundancy: 0.1, impressions: 0 },
    ],
    1,
  );
  assert.deepEqual(onlyRelevance, [0.5, 0.5]);
});
void test('all policies preserve no-repeat, family, publisher and hard-no constraints with recorded decisions', () => {
  for (const policy of ['baseline', 'mmr', 'linucb'] as DiscoveryPolicy[]) {
    const result = selectDaily({
      games,
      tags,
      taste,
      seenGameIds: new Set([games[0].id]),
      seenFamilyKeys: new Set([games[1].familyKey]),
      settings: { ...DEFAULT_DISCOVERY, policy },
      feedback: observations(20),
      liveFeedback: true,
      random: () => 0.42,
    });
    assert.equal(result.games.length, 3);
    assert.equal(new Set(result.games.map((game) => game.developerId)).size, 3);
    assert.equal(
      new Set(result.games.map((game) => game.publisherKey)).size,
      3,
    );
    assert.ok(
      result.games.every(
        (game) =>
          ![games[0].id, games[1].id].includes(game.id) &&
          !game.content.tagIds.includes(tag('FPS')),
      ),
    );
    assert.equal(result.policy.applied, policy);
    assert.deepEqual(
      result.decisions.map((decision) => decision.gameId),
      result.games.map((game) => game.id),
    );
    for (const decision of result.decisions) {
      assert.equal(decision.features.length, BANDIT.dimensions);
      assert.ok(
        decision.features.every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
      );
      if (policy === 'baseline') assert.equal(decision.probability, null);
      else assert.ok(decision.probability! > 0 && decision.probability! <= 1);
    }
  }
});
void test('contextual exploration requires real varied feedback and safely falls back for cold or demo users', () => {
  const base = {
    games,
    tags,
    taste,
    seenGameIds: new Set<string>(),
    settings: { ...DEFAULT_DISCOVERY, policy: 'linucb' as const },
    random: () => 0.42,
  };
  for (const input of [
    { feedback: observations(19), liveFeedback: true },
    { feedback: observations(25), liveFeedback: false },
    {
      feedback: Array.from({ length: 25 }, () => ({
        features: bias,
        reward: 1 as const,
      })),
      liveFeedback: true,
    },
  ]) {
    const result = selectDaily({ ...base, ...input });
    assert.equal(result.policy.applied, 'mmr');
    assert.ok(result.policy.fallbackReason);
  }
  assert.equal(
    selectDaily({ ...base, feedback: observations(20), liveFeedback: true })
      .policy.applied,
    'linucb',
  );
  assert.equal(
    parseDiscoverySettings({ ...DEFAULT_DISCOVERY, policy: 'paid-boost' }),
    null,
  );
  assert.equal(
    parseDiscoverySettings({ ...DEFAULT_DISCOVERY, exploration: Infinity }),
    null,
  );
});
