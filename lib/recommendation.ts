import { CONFIG } from './config.ts';
import {
  BANDIT,
  DEFAULT_DISCOVERY,
  discoveryProbabilities,
  fitLinearBandit,
  linearPrediction,
  parseDiscoverySettings,
  type BanditObservation,
  type DiscoveryPolicy,
  type DiscoverySettings,
} from './discovery-policy.ts';
import type {
  CandidateGame,
  DiscoveryMode,
  SteamTag,
  TasteProfile,
} from './types.ts';
export type Vector = Map<number, number>;

export function buildUserVector(
  taste: TasteProfile,
  tags: readonly SteamTag[],
  behavior: Record<number, number> = {},
): Vector {
  const catalog = new Map(tags.map((tag) => [tag.id, tag]));
  const vector: Vector = new Map();
  for (const id of taste.genres)
    vector.set(id, catalog.get(id)?.category === 'subgenre' ? 3 : 2.5);
  for (const id of taste.mechanics)
    vector.set(id, Math.max(vector.get(id) ?? 0, 2.5));
  for (const id of taste.moods)
    vector.set(id, Math.max(vector.get(id) ?? 0, 1.5));
  for (const [id, weight] of Object.entries(behavior)) {
    if (catalog.has(Number(id)))
      vector.set(
        Number(id),
        (vector.get(Number(id)) ?? 0) +
          Math.max(
            -CONFIG.maxBehaviorWeight,
            Math.min(CONFIG.maxBehaviorWeight, weight),
          ),
      );
  }
  // Explicit hard-no settings always win over inferred behavior.
  for (const id of taste.hardNo) vector.set(id, CONFIG.initialWeights.hardNo);
  return vector;
}
export function computeRarity(games: readonly CandidateGame[]): Vector {
  const counts = new Map<number, number>();
  for (const game of games)
    for (const id of new Set(game.content.tagIds))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  return new Map(
    [...counts].map(([id, count]) => [
      id,
      Math.max(0.2, Math.min(2, Math.log((games.length + 1) / (count + 1)))),
    ]),
  );
}
export function gameVector(
  game: CandidateGame,
  tags: ReadonlyMap<number, SteamTag>,
  rarity: Vector,
): Vector {
  return new Map(
    game.content.tagIds.slice(0, 20).map((id, index) => {
      const tag = tags.get(id);
      const rank = index < 5 ? 1 : index < 10 ? 0.75 : index < 15 ? 0.5 : 0.3;
      const category =
        tag?.subcategory === 'broad'
          ? 0.6
          : CONFIG.categoryWeights[tag?.category ?? 'metadata'];
      return [id, rank * (rarity.get(id) ?? 1) * category];
    }),
  );
}
export function cosine(a: Vector, b: Vector): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (const [id, value] of a) {
    dot += value * (b.get(id) ?? 0);
    normA += value * value;
  }
  for (const value of b.values()) normB += value * value;
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}
export function quantile(sorted: number[], percentile: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * percentile;
  const lo = Math.floor(index),
    hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
}

export interface SelectionInput {
  games: CandidateGame[];
  tags: SteamTag[];
  taste: TasteProfile;
  seenGameIds: Set<string>;
  seenFamilyKeys?: Set<string>;
  behavior?: Record<number, number>;
  now?: number;
  random?: () => number;
  settings?: DiscoverySettings;
  feedback?: BanditObservation[];
  liveFeedback?: boolean;
}
export interface SelectionResult {
  games: CandidateGame[];
  threshold: number;
  eligibleCount: number;
  relevantCount: number;
  expanded: boolean;
  scores: Record<string, number>;
  meanPairwiseSimilarity: number | null;
  outsideFocusGameIds: string[] | null;
  policy: {
    requested: DiscoveryPolicy;
    applied: DiscoveryPolicy;
    featureVersion: string;
    feedbackSamples: number;
    positives: number;
    negatives: number;
    fallbackReason: string | null;
    relevanceWeight: number;
    exploration: number;
  };
  decisions: {
    gameId: string;
    features: number[];
    probability: number | null;
  }[];
}

export function selectDaily(input: SelectionInput): SelectionResult {
  const random = input.random ?? secureRandom;
  const now = input.now ?? Date.now();
  const settings = parseDiscoverySettings(input.settings) ?? {
    ...DEFAULT_DISCOVERY,
  };
  const model = fitLinearBandit(
    settings.policy === 'linucb' && input.liveFeedback
      ? (input.feedback ?? [])
      : [],
  );
  let policy = settings.policy,
    fallbackReason: string | null = null;
  if (policy === 'linucb') {
    if (!input.liveFeedback)
      fallbackReason = 'Live independent feedback is required.';
    else if (model.samples < BANDIT.minimumSamples)
      fallbackReason = 'At least 20 rated independent games are required.';
    else if (
      Math.min(model.positives, model.negatives) < BANDIT.minimumPerOutcome
    )
      fallbackReason =
        'At least three positive and three negative outcomes are required.';
    if (fallbackReason) policy = 'mmr';
  }
  const catalog = new Map(input.tags.map((tag) => [tag.id, tag]));
  const hardGenre = new Set(
    input.taste.hardNo.filter((id) =>
      ['subgenre', 'genre'].includes(catalog.get(id)?.category ?? ''),
    ),
  );
  const eligible = input.games.filter((game) => {
    if (
      game.status !== 'published' ||
      !game.content.capsule ||
      game.content.screenshots.length < 1 ||
      !game.content.description
    )
      return false;
    const seen =
      input.seenGameIds.has(game.id) ||
      input.seenFamilyKeys?.has(game.familyKey);
    const retest = game.retest;
    if (
      seen &&
      !(
        retest?.changedPresentation &&
        now - retest.previousExposureAt >= CONFIG.retestCooldownMs
      )
    )
      return false;
    return !game.content.tagIds.some((id) => hardGenre.has(id));
  });
  const rarity = computeRarity(
    input.games.filter((g) => g.status === 'published'),
  );
  const user = buildUserVector(input.taste, input.tags, input.behavior);
  const vectors = new Map(
    eligible.map((g) => [g.id, gameVector(g, catalog, rarity)]),
  );
  const scores = Object.fromEntries(
    eligible.map((g) => [g.id, cosine(user, vectors.get(g.id)!)]),
  );
  const positive = new Map([...user].filter(([, weight]) => weight > 0));
  const negative = new Map(
    [...user]
      .filter(([, weight]) => weight < 0)
      .map(([id, weight]) => [id, -weight]),
  );
  const categoryGroups = [
    ['genre', 'subgenre'],
    ['mechanic'],
    ['mood'],
    ['visual'],
    ['player'],
  ];
  const groupedUser = categoryGroups.map(
    (categories) =>
      new Map(
        [...positive].filter(([id]) =>
          categories.includes(catalog.get(id)?.category ?? ''),
        ),
      ),
  );
  const contexts = new Map<string, number[]>();
  const learnedScores = new Map<string, number>();
  const contextFor = (game: CandidateGame) => {
    let context = contexts.get(game.id);
    if (!context) {
      const vector = vectors.get(game.id)!;
      context = [
        1,
        Math.max(0, cosine(positive, vector)),
        ...categoryGroups.map((categories, i) =>
          Math.max(
            0,
            cosine(
              groupedUser[i],
              new Map(
                [...vector].filter(([id]) =>
                  categories.includes(catalog.get(id)?.category ?? ''),
                ),
              ),
            ),
          ),
        ),
        Math.max(0, cosine(negative, vector)),
      ].map((value) => Math.max(0, Math.min(1, value)));
      contexts.set(game.id, context);
    }
    return context;
  };
  const decisions: SelectionResult['decisions'] = [];
  const sorted = Object.values(scores).sort((a, b) => a - b);
  const initialThreshold = quantile(
    sorted,
    CONFIG.percentiles[input.taste.discoveryMode as DiscoveryMode],
  );
  let threshold = initialThreshold;
  let relevant = eligible.filter((g) => scores[g.id] >= threshold);
  // Relax only the percentile. Never relax hard exclusions or novelty constraints.
  const uniqueCount = (pool: CandidateGame[]) =>
    new Set(pool.map((g) => g.developerId)).size;
  for (const percentile of [0.25, 0]) {
    if (uniqueCount(relevant) >= CONFIG.dailyCount) break;
    threshold = Math.min(threshold, quantile(sorted, percentile));
    relevant = eligible.filter((g) => scores[g.id] >= threshold);
  }
  const chosen: CandidateGame[] = [],
    developers = new Set<string>(),
    publishers = new Set<string>(),
    families = new Set<string>();
  const canSelect = (g: CandidateGame) =>
    !developers.has(g.developerId) &&
    (!g.publisherKey || !publishers.has(g.publisherKey)) &&
    !families.has(g.familyKey);
  const draw = (pool: CandidateGame[]) => {
    const weights = pool.map(
      (g) => 1 / Math.sqrt(1 + Math.max(0, g.qualifiedImpressions)),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let target = Math.max(0, Math.min(0.999999999, random())) * total;
    for (let i = 0; i < pool.length; i++) {
      target -= weights[i];
      if (target < 0) return pool[i];
    }
    return pool[pool.length - 1];
  };
  while (chosen.length < CONFIG.dailyCount) {
    const pool = relevant.filter(canSelect);
    if (!pool.length) {
      const broader = eligible.filter(canSelect);
      if (!broader.length) break;
      // Shared publishers can make a seemingly large pool too small.
      threshold = Math.min(threshold, ...broader.map((g) => scores[g.id]));
      relevant = eligible.filter((g) => scores[g.id] >= threshold);
      continue;
    }
    let candidate: CandidateGame,
      probability: number | null = null;
    if (policy !== 'baseline') {
      const probabilities = discoveryProbabilities(
        pool.map((game) => {
          let relevance = Math.max(0, scores[game.id]);
          if (policy === 'linucb') {
            let learned = learnedScores.get(game.id);
            if (learned === undefined) {
              const prediction = linearPrediction(model, contextFor(game));
              learned = Math.max(
                0,
                Math.min(
                  1,
                  prediction.mean +
                    settings.exploration * prediction.uncertainty,
                ),
              );
              learnedScores.set(game.id, learned);
            }
            relevance = 0.65 * relevance + 0.35 * learned;
          }
          return {
            relevance,
            redundancy: Math.max(
              0,
              ...chosen.map((other) =>
                cosine(vectors.get(other.id)!, vectors.get(game.id)!),
              ),
            ),
            impressions: game.qualifiedImpressions,
          };
        }),
        settings.relevanceWeight,
      );
      let target = Math.max(0, Math.min(0.999999999, random())),
        index = 0;
      for (; index < pool.length - 1; index++) {
        target -= probabilities[index];
        if (target < 0) break;
      }
      candidate = pool[index];
      probability = probabilities[index];
    } else candidate = draw(pool);
    for (
      let attempt = 0;
      policy === 'baseline' && attempt < CONFIG.diversityAttempts;
      attempt++
    ) {
      if (
        chosen.every(
          (g) =>
            cosine(vectors.get(g.id)!, vectors.get(candidate.id)!) <=
            CONFIG.overlapThreshold,
        )
      )
        break;
      const alternatives = pool.filter(
        (g) =>
          g.id !== candidate.id &&
          chosen.every(
            (other) =>
              cosine(vectors.get(other.id)!, vectors.get(g.id)!) <=
              CONFIG.overlapThreshold,
          ),
      );
      if (!alternatives.length) break;
      candidate = draw(alternatives);
    }
    chosen.push(candidate);
    decisions.push({
      gameId: candidate.id,
      features: contextFor(candidate),
      probability,
    });
    developers.add(candidate.developerId);
    if (candidate.publisherKey) publishers.add(candidate.publisherKey);
    families.add(candidate.familyKey);
  }
  const pairwise: number[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      pairwise.push(
        cosine(vectors.get(chosen[i].id)!, vectors.get(chosen[j].id)!),
      );
    }
  }
  const strongestWeight = Math.max(
    0,
    ...input.taste.genres.map((id) => user.get(id) ?? 0),
  );
  const strongestGenres = new Set(
    input.taste.genres.filter(
      (id) => strongestWeight > 0 && user.get(id) === strongestWeight,
    ),
  );
  return {
    games: chosen,
    threshold,
    eligibleCount: eligible.length,
    relevantCount: relevant.length,
    expanded: threshold < initialThreshold,
    scores,
    policy: {
      requested: settings.policy,
      applied: policy,
      featureVersion: BANDIT.featureVersion,
      feedbackSamples: model.samples,
      positives: model.positives,
      negatives: model.negatives,
      fallbackReason,
      relevanceWeight: settings.relevanceWeight,
      exploration: settings.exploration,
    },
    decisions,
    meanPairwiseSimilarity: pairwise.length
      ? pairwise.reduce((sum, value) => sum + value, 0) / pairwise.length
      : null,
    outsideFocusGameIds: strongestGenres.size
      ? chosen
          .filter(
            (game) =>
              !game.content.tagIds.some((id) => strongestGenres.has(id)),
          )
          .map((game) => game.id)
      : null,
  };
}
