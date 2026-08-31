import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  BANDIT,
  DEFAULT_DISCOVERY,
  type BanditObservation,
  type DiscoveryPolicy,
} from '../lib/discovery-policy.ts';
import { selectDaily } from '../lib/recommendation.ts';
import type { CandidateGame, GameContent, SteamTag } from '../lib/types.ts';

const tags = JSON.parse(
  await readFile(new URL('../data/steam_tags.json', import.meta.url), 'utf8'),
) as SteamTag[];
const materials = JSON.parse(
  await readFile(new URL('../data/demo_games.json', import.meta.url), 'utf8'),
) as GameContent[];
const games: CandidateGame[] = Array.from({ length: 3000 }, (_, i) => ({
  id: `benchmark-${i}`,
  developerId: `studio-${Math.floor(i / 2)}`,
  publisherKey: `publisher-${Math.floor(i / 6)}`,
  familyKey: `family-${Math.floor(i / 2)}`,
  versionId: `version-${i}`,
  status: 'published',
  isDemo: false,
  qualifiedImpressions: i % 100,
  content: materials[i % materials.length],
}));
const tag = (name: string) =>
  tags.find((entry) => entry.steam_name === name)!.id;
const feedback: BanditObservation[] = Array.from(
  { length: BANDIT.maximumSamples },
  (_, i) => ({
    features: [1, i % 2, 0.5, 0.2, 0, 0, 0, 0],
    reward: i % 2 ? 1 : 0,
  }),
);
let seed = 742381;
const random = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const results = [];
for (const policy of ['baseline', 'mmr', 'linucb'] as DiscoveryPolicy[]) {
  global.gc?.();
  const before = process.memoryUsage().heapUsed,
    times = [];
  let peakObservedHeap = before;
  for (let iteration = 0; iteration < 65; iteration++) {
    const start = performance.now();
    const result = selectDaily({
      games,
      tags,
      taste: {
        genres: [tag('Adventure'), tag('RPG'), tag('Strategy')],
        mechanics: [tag('Exploration')],
        moods: [],
        hardNo: [tag('FPS')],
        discoveryMode: 'curious',
      },
      seenGameIds: new Set(),
      settings: { ...DEFAULT_DISCOVERY, policy },
      feedback,
      liveFeedback: true,
      random,
    });
    if (result.games.length !== 3 || result.policy.applied !== policy)
      throw new Error('Benchmark selection failed.');
    if (iteration >= 5) times.push(performance.now() - start);
    peakObservedHeap = Math.max(
      peakObservedHeap,
      process.memoryUsage().heapUsed,
    );
  }
  global.gc?.();
  times.sort((a, b) => a - b);
  results.push({
    policy,
    trials: times.length,
    p50Ms: Number(times[Math.floor(times.length * 0.5)].toFixed(2)),
    p95Ms: Number(times[Math.floor(times.length * 0.95)].toFixed(2)),
    maxMs: Number(times.at(-1)!.toFixed(2)),
    peakObservedHeapMiB: Number((peakObservedHeap / 1048576).toFixed(2)),
    retainedHeapDeltaMiB: Number(
      ((process.memoryUsage().heapUsed - before) / 1048576).toFixed(2),
    ),
  });
}
const report = {
  date: new Date().toISOString(),
  catalogSize: games.length,
  feedbackExamples: feedback.length,
  results,
  peakProcessRssMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(2)),
  scope:
    'Synthetic, local Node benchmark of pure selection only. It is not a production load test, real player evidence, or a D1/network timing guarantee. No database or external service was modified.',
};
await mkdir(new URL('../../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../artifacts/discovery-benchmark.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
