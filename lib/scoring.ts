import { CONFIG } from './config.ts';
import { formatCount } from './format.ts';
import type {
  GameContent,
  GuessSnapshot,
  SteamTag,
  TargetTags,
} from './types.ts';

export function availableStages(game: GameContent): number[] {
  return [
    1,
    ...(game.screenshots.length ? [2] : []),
    ...(game.screenshots.length >= 3 ? [3] : []),
    ...(game.youtubeId ? [4, 5] : []),
    6,
  ];
}
export function scoreGuess(
  guess: GuessSnapshot,
  target: TargetTags,
  stage: number,
  tags: readonly SteamTag[],
) {
  const catalog = new Map(tags.map((t) => [t.id, t]));
  const groupWeights = { genre: 0.5, core: 0.35, mood: 0.15 };
  let accuracy = 0,
    activeWeight = 0;
  const correct = new Set<number>(),
    missed = new Set<number>(),
    wrong = new Set<number>();
  for (const group of ['genre', 'core', 'mood'] as const) {
    const expected = new Set(target[group]);
    const selected = new Set(guess[group]);
    if (!expected.size) continue;
    const weight = (id: number) =>
      CONFIG.categoryWeights[catalog.get(id)?.category ?? 'metadata'];
    let hit = 0,
      total = 0,
      falsePositive = 0;
    for (const id of expected) {
      total += weight(id);
      if (selected.has(id)) {
        hit += weight(id);
        correct.add(id);
      } else missed.add(id);
    }
    for (const id of selected)
      if (!expected.has(id)) {
        wrong.add(id);
        falsePositive += weight(id);
      }
    // Weighted Jaccard discourages selecting every plausible answer.
    accuracy +=
      groupWeights[group] *
      (total + falsePositive ? hit / (total + falsePositive) : 0);
    activeWeight += groupWeights[group];
  }
  accuracy = activeWeight ? accuracy / activeWeight : 0;
  return {
    score: Math.round((CONFIG.stagePoints[stage - 1] ?? 0) * accuracy),
    accuracy: Math.round(accuracy * 1000) / 10,
    correct: [...correct],
    missed: [...missed],
    wrong: [...wrong],
  };
}

export function spoilerFreeShare(
  date: string,
  results: { score: number; accuracy: number; stage: number }[],
): string {
  return `FindNewGame · ${date}\n${results.map((r) => Array.from({ length: 6 }, (_, i) => (i < r.stage - 1 ? '⬜' : i === r.stage - 1 ? (r.accuracy >= 70 ? '🟩' : r.accuracy >= 35 ? '🟨' : '🟦') : '⬛')).join('')).join('\n')}\n${formatCount(
    results.reduce((n, r) => n + r.score, 0),
    'point',
  )} · ${results.length}/3 games\nThree unknown games. One new discovery.`;
}
