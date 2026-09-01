import type { DiscoveryMode, TagCategory } from './types.ts';
export const CONFIG = {
  dailyCount: 3,
  algorithmVersion: 'taste-random-v1.1',
  categoryWeights: {
    subgenre: 1.5,
    genre: 1.2,
    mechanic: 1.4,
    mood: 0.85,
    visual: 0.55,
    player: 0.35,
    metadata: 0.1,
  } satisfies Record<TagCategory, number>,
  initialWeights: {
    subgenre: 3,
    genre: 2.5,
    mechanic: 2.5,
    mood: 1.5,
    hardNo: -5,
  },
  percentiles: { safe: 0.7, balanced: 0.5, curious: 0.35 } satisfies Record<
    DiscoveryMode,
    number
  >,
  stagePoints: [1000, 800, 650, 500],
  stageNames: ['Artwork', 'First screenshot', 'Gallery', 'Trailer / teaser'],
  overlapThreshold: 0.8,
  diversityAttempts: 5,
  retestCooldownMs: 14 * 86_400_000,
  minimumAggregateUsers: 20,
  minimumUsefulSample: 100,
  behavior: {
    would_play: 0.4,
    save: 0.7,
    steam_click: 0.8,
    follow: 0.6,
    not_for_me: -0.4,
  },
  maxBehaviorWeight: 3,
  maxUploadBytes: 3 * 1024 * 1024,
  maxUserAssetBytes: 100 * 1024 * 1024,
  minStageDurationMs: 700,
  demoLifetimeMs: 24 * 60 * 60 * 1000,
  defaultImpressionPriceCents: 1,
  maxTagSelection: 20,
  maxGuessTagsPerGroup: 3,
  maxCatalogSize: 3000,
};
export const EMPTY_TASTE = {
  genres: [],
  mechanics: [],
  moods: [],
  hardNo: [],
  discoveryMode: 'balanced' as const,
};
export const EMPTY_GUESS = { genre: [], core: [], mood: [], wouldClick: null };
