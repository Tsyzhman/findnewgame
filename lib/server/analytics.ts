import { CONFIG } from '@/lib/config';
import type { GameContent, GuessSnapshot, PublicUser } from '@/lib/types';
import { scoreGuess } from '@/lib/scoring';
import { all, database, first, tags } from './database';
import { ownedGame } from './developer';
import { requireCondition } from './security';

export async function calibrationReport(
  user: PublicUser,
  gameId: string,
  versionId?: string,
) {
  const db = await database(),
    game = await ownedGame(user, gameId);
  const versions = await all<{
    id: string;
    version: number;
    created_at: number;
  }>(
    db,
    'SELECT id,version,created_at FROM game_versions WHERE game_id=? ORDER BY version DESC',
    gameId,
  );
  const selected = versionId
    ? versions.find((v) => v.id === versionId)
    : versions[0];
  requireCondition(
    selected,
    'This material version does not belong to the game.',
    404,
  );
  const results = await all<{
    assignment_id: string;
    user_id: string;
    accuracy: number;
    stage: number;
    variant_id: string | null;
  }>(
    db,
    'SELECT assignment_id,user_id,accuracy,stage,variant_id FROM quiz_final_results WHERE game_id=? AND version_id=? AND qualified=1 AND repeat_exposure=0 ORDER BY completed_at DESC,assignment_id LIMIT 10000',
    gameId,
    selected.id,
  );
  const sampleSize = new Set(results.map((r) => r.user_id)).size;
  const base = {
    gameId,
    title: (JSON.parse(game.content_json) as GameContent).title,
    versions,
    selectedVersion: selected.id,
    sampleSize,
    minimumSample: CONFIG.minimumAggregateUsers,
    usefulSample: CONFIG.minimumUsefulSample,
    privacySuppressed: sampleSize < CONFIG.minimumAggregateUsers,
  };
  if (base.privacySuppressed)
    return {
      ...base,
      funnel: [],
      misconceptions: [],
      confusion: [],
      segments: [],
      wouldPlay: null,
      notice:
        'At least 20 independent first-impression participants are needed before aggregate answers are shown. Owner, team, demo, and repeat sessions are excluded.',
    };
  const snapshots = await all<{
    assignment_id: string;
    stage: number;
    guess_json: string;
    requested_more: number;
  }>(
    db,
    'WITH recent AS (SELECT assignment_id FROM quiz_final_results WHERE game_id=? AND version_id=? AND qualified=1 AND repeat_exposure=0 ORDER BY completed_at DESC,assignment_id LIMIT 10000) SELECT s.assignment_id,s.stage,s.guess_json,s.requested_more FROM quiz_stage_guesses s JOIN recent r ON r.assignment_id=s.assignment_id ORDER BY s.assignment_id,s.stage',
    gameId,
    selected.id,
  );
  const byId = new Map(results.map((r) => [r.assignment_id, r]));
  const original = await first<{ content_json: string }>(
    db,
    'SELECT content_json FROM game_versions WHERE id=?',
    selected.id,
  );
  const baseContent: GameContent = JSON.parse(original!.content_json);
  const variantRows = await all<{ id: string; content_json: string }>(
    db,
    'SELECT v.id,v.content_json FROM experiment_variants v JOIN experiments e ON e.id=v.experiment_id WHERE e.base_version_id=?',
    selected.id,
  );
  const contentByVariant = new Map(
    variantRows.map((v) => [v.id, JSON.parse(v.content_json) as GameContent]),
  );
  const buckets = Array.from({ length: 6 }, () => ({
    participants: new Set<string>(),
    accuracy: 0,
    yes: 0,
    uncertain: 0,
    pairedGain: 0,
    pairs: 0,
  }));
  const misconceptions = new Map<number, Set<string>>(),
    matrix = new Map<string, Set<string>>(),
    previous = new Map<string, number>();
  for (const snapshot of snapshots) {
    const result = byId.get(snapshot.assignment_id);
    if (!result) continue;
    const content =
        (result.variant_id ? contentByVariant.get(result.variant_id) : null) ??
        baseContent,
      guess: GuessSnapshot = JSON.parse(snapshot.guess_json);
    const score = scoreGuess(guess, content.targets, snapshot.stage, tags);
    const bucket = buckets[snapshot.stage - 1];
    bucket.participants.add(result.user_id);
    bucket.accuracy += score.accuracy;
    if (guess.wouldClick === 'yes') bucket.yes++;
    if (snapshot.requested_more) bucket.uncertain++;
    const before = previous.get(snapshot.assignment_id);
    if (before !== undefined) {
      bucket.pairedGain += score.accuracy - before;
      bucket.pairs++;
    }
    previous.set(snapshot.assignment_id, score.accuracy);
    if (snapshot.stage === 1)
      for (const guessed of guess.genre) {
        const set = misconceptions.get(guessed) ?? new Set();
        set.add(result.user_id);
        misconceptions.set(guessed, set);
        for (const expected of content.targets.genre) {
          const key = `${expected}:${guessed}`;
          const matches = matrix.get(key) ?? new Set();
          matches.add(result.user_id);
          matrix.set(key, matches);
        }
      }
  }
  const funnel = buckets.map((bucket, i) => ({
    stage: i + 1,
    name: CONFIG.stageNames[i],
    sampleSize: bucket.participants.size,
    accuracy:
      bucket.participants.size >= 20
        ? bucket.accuracy / bucket.participants.size
        : null,
    wouldClick:
      bucket.participants.size >= 20
        ? (100 * bucket.yes) / bucket.participants.size
        : null,
    needClue:
      bucket.participants.size >= 20
        ? (100 * bucket.uncertain) / bucket.participants.size
        : null,
    pairedInformationGain:
      bucket.pairs >= 20 ? bucket.pairedGain / bucket.pairs : null,
    pairedSampleSize: bucket.pairs,
  }));
  const segments = await all<{
    tagId: number;
    sampleSize: number;
    accuracy: number;
  }>(
    db,
    'WITH recent AS (SELECT user_id,accuracy FROM quiz_final_results WHERE game_id=? AND version_id=? AND qualified=1 AND repeat_exposure=0 ORDER BY completed_at DESC,assignment_id LIMIT 10000) SELECT p.tag_id tagId,COUNT(DISTINCT r.user_id) sampleSize,AVG(r.accuracy) accuracy FROM recent r JOIN user_tag_preferences p ON p.user_id=r.user_id AND p.explicit_weight>0 GROUP BY p.tag_id HAVING COUNT(DISTINCT r.user_id)>=? ORDER BY sampleSize DESC LIMIT 12',
    gameId,
    selected.id,
    CONFIG.minimumAggregateUsers,
  );
  const intent = await first<{ n: number; positive: number }>(
    db,
    "WITH recent AS (SELECT assignment_id,user_id FROM quiz_final_results WHERE game_id=? AND version_id=? AND qualified=1 AND repeat_exposure=0 ORDER BY completed_at DESC,assignment_id LIMIT 10000) SELECT COUNT(DISTINCT i.user_id) n,COUNT(DISTINCT CASE WHEN i.kind='would_play' THEN i.user_id END) positive FROM game_interactions i JOIN recent r ON r.assignment_id=i.assignment_id AND r.user_id=i.user_id WHERE i.active=1 AND i.kind IN ('would_play','not_for_me')",
    gameId,
    selected.id,
  );
  return {
    ...base,
    funnel,
    misconceptions: [...misconceptions]
      .map(([tagId, people]) => ({
        tagId,
        count: people.size,
        percentage: (100 * people.size) / sampleSize,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    confusion: [...matrix]
      .map(([key, people]) => ({
        expectedTag: Number(key.split(':')[0]),
        guessedTag: Number(key.split(':')[1]),
        count: people.size,
        percentage: (100 * people.size) / sampleSize,
        stage: 1,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    segments,
    wouldPlay:
      intent && intent.n >= 20 ? (100 * intent.positive) / intent.n : null,
    notice:
      'Accuracy is conditional on viewing each clue. Information gain uses paired answers from the same viewers; it is descriptive, not a causal estimate. Results are capped at the latest 10,000 completed rounds per version.',
  };
}
