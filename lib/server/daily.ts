import { env } from 'cloudflare:workers';
import type {
  CandidateGame,
  DailyRelevance,
  DailyView,
  GameContent,
  PublicUser,
} from '@/lib/types';
import { CONFIG, EMPTY_TASTE } from '@/lib/config';
import { selectDaily } from '@/lib/recommendation';
import { clueStageFor } from '@/lib/scoring';
import { localDate, nextLocalMidnight, streaks } from '@/lib/time';
import {
  activeTags,
  all,
  database,
  first,
  id,
  sha256,
  tags as canonicalTags,
} from './database';
import { requireCondition } from './security';
import { discoveryFeedback, discoverySettings } from './discovery-policy';

type CandidateRow = {
  id: string;
  developer_id: string;
  publisher_key: string;
  family_key: string;
  current_version_id: string;
  content_json: string;
  status: string;
  is_demo: number;
  impressions: number;
};
type SetRow = {
  id: string;
  local_date: string;
  timezone: string;
  reset_at: number;
  catalog_mode: 'demo' | 'live';
  completed_at: number | null;
  relevance: DailyRelevance | null;
};
export async function behaviorWeights(
  db: D1Database,
  userId: string,
): Promise<Record<number, number>> {
  const rows = await all<{
    kind: keyof typeof CONFIG.behavior;
    tag_ids_json: string;
  }>(
    db,
    'SELECT kind,tag_ids_json FROM game_interactions WHERE user_id=? AND active=1',
    userId,
  );
  const weights: Record<number, number> = {};
  for (const row of rows) {
    const delta = CONFIG.behavior[row.kind] ?? 0;
    for (const tag of JSON.parse(row.tag_ids_json) as number[])
      weights[tag] = (weights[tag] ?? 0) + delta;
  }
  return weights;
}
export async function candidateGames(
  db: D1Database,
  mode: 'demo' | 'live',
): Promise<CandidateGame[]> {
  const rows = await all<CandidateRow>(
    db,
    `SELECT g.*,v.content_json,(SELECT COUNT(*) FROM quiz_final_results r WHERE r.game_id=g.id AND r.qualified=1 AND r.repeat_exposure=0) AS impressions FROM games g JOIN game_versions v ON v.id=g.current_version_id WHERE g.status='published' ${mode === 'live' ? 'AND g.is_demo=0' : ''} ORDER BY g.id LIMIT ?`,
    CONFIG.maxCatalogSize,
  );
  return rows.map((row) => ({
    id: row.id,
    developerId: row.developer_id,
    publisherKey: row.publisher_key,
    familyKey: row.family_key,
    versionId: row.current_version_id,
    content: JSON.parse(row.content_json),
    status: row.status,
    isDemo: !!row.is_demo,
    qualifiedImpressions: row.impressions,
  }));
}
export async function dailyFor(user: PublicUser): Promise<DailyView> {
  requireCondition(
    user.onboarded || user.isDemo,
    'Set up your taste profile before starting your Daily.',
    409,
    'onboarding_required',
  );
  const db = await database(),
    now = Date.now();
  let set = await first<SetRow>(
    db,
    'SELECT * FROM daily_sets WHERE user_id=? AND reset_at>? ORDER BY created_at DESC LIMIT 1',
    user.id,
    now,
  );
  if (!set) {
    const date = localDate(now, user.timezone);
    set = await first<SetRow>(
      db,
      'SELECT * FROM daily_sets WHERE user_id=? AND local_date=?',
      user.id,
      date,
    );
    if (!set) {
      const mode = user.isDemo || env.CATALOG_MODE !== 'live' ? 'demo' : 'live';
      const [games, tags, seen, behavior] = await Promise.all([
        candidateGames(db, mode),
        activeTags(db),
        all<{
          game_id: string;
          family_key: string;
          last_exposure: number;
          presentation_hashes: string;
        }>(
          db,
          'SELECT a.game_id,a.family_key,MAX(a.created_at) AS last_exposure,json_group_array(DISTINCT COALESCE(ev.presentation_hash,v.presentation_hash)) presentation_hashes FROM daily_assignments a JOIN game_versions v ON v.id=a.version_id LEFT JOIN experiment_variants ev ON ev.id=a.variant_id WHERE a.user_id=? GROUP BY a.game_id,a.family_key',
          user.id,
        ),
        behaviorWeights(db, user.id),
      ]);
      const seenByGame = new Map(seen.map((s) => [s.game_id, s.last_exposure]));
      const experiments = await all<{
        id: string;
        game_id: string;
        is_retest: number;
        challenger_hash: string;
        existing_cohort: string | null;
      }>(
        db,
        "SELECT e.id,e.game_id,e.is_retest,b.presentation_hash challenger_hash,ea.id existing_cohort FROM experiments e JOIN experiment_variants b ON b.experiment_id=e.id AND b.label='B' LEFT JOIN experiment_assignments ea ON ea.experiment_id=e.id AND ea.user_id=? WHERE e.status='active' ORDER BY e.created_at DESC",
        user.id,
      );
      for (const game of games) {
        const experiment = experiments.find(
          (e) => e.game_id === game.id && e.is_retest,
        );
        const last = seenByGame.get(game.id);
        const seenHashes: string[] = JSON.parse(
          seen.find((s) => s.game_id === game.id)?.presentation_hashes ?? '[]',
        );
        if (experiment && last && !experiment.existing_cohort)
          game.retest = {
            experimentId: experiment.id,
            changedPresentation: !seenHashes.includes(
              experiment.challenger_hash,
            ),
            previousExposureAt: last,
          };
      }
      const activeTagIds = new Set(tags.map((tag) => tag.id));
      const settings = await discoverySettings(db);
      const feedback =
        settings.policy === 'linucb' && mode === 'live'
          ? await discoveryFeedback(db, user, now)
          : [];
      const result = selectDaily({
        games: games.filter((game) =>
          Object.values(game.content.targets)
            .flat()
            .every((tag) => activeTagIds.has(tag)),
        ),
        tags: canonicalTags,
        taste: user.taste ?? EMPTY_TASTE,
        seenGameIds: new Set(seen.map((s) => s.game_id)),
        seenFamilyKeys: new Set(seen.map((s) => s.family_key)),
        behavior,
        now,
        settings,
        feedback,
        liveFeedback: mode === 'live' && !user.isDemo,
      });
      const setId = id('day-');
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            'INSERT OR IGNORE INTO daily_sets (id,user_id,local_date,timezone,reset_at,catalog_mode,algorithm_version,selection_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            setId,
            user.id,
            date,
            user.timezone,
            nextLocalMidnight(now, user.timezone),
            mode,
            result.policy.applied === 'baseline'
              ? CONFIG.algorithmVersion
              : `taste-${result.policy.applied}-v1.0`,
            JSON.stringify({
              threshold: result.threshold,
              eligible: result.eligibleCount,
              relevant: result.relevantCount,
              expanded: result.expanded,
              meanPairwiseSimilarity: result.meanPairwiseSimilarity,
              outsideFocusGameIds: result.outsideFocusGameIds,
              policy: result.policy,
              decisions: result.decisions,
            }),
            now,
          ),
      ];
      for (let slot = 0; slot < result.games.length; slot++) {
        const game = result.games[slot],
          experiment = experiments.find((e) => e.game_id === game.id),
          repeat = seenByGame.has(game.id);
        let variantId: string | null = null;
        let cohortStatement: D1PreparedStatement | undefined;
        if (experiment) {
          const variants = await all<{ id: string; label: string }>(
            db,
            'SELECT id,label FROM experiment_variants WHERE experiment_id=? ORDER BY label',
            experiment.id,
          );
          if (variants.length) {
            const prior = await first<{ variant_id: string }>(
              db,
              'SELECT variant_id FROM experiment_assignments WHERE experiment_id=? AND user_id=?',
              experiment.id,
              user.id,
            );
            const bucket =
              parseInt(
                (await sha256(`${experiment.id}:${user.id}`)).slice(0, 8),
                16,
              ) % variants.length;
            variantId =
              prior?.variant_id ??
              (repeat
                ? variants.find((v) => v.label === 'B')?.id
                : variants[bucket]?.id) ??
              variants[0].id;
            cohortStatement = db
              .prepare(
                'INSERT OR IGNORE INTO experiment_assignments (id,experiment_id,user_id,variant_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daily_assignments WHERE set_id=? AND variant_id=?)',
              )
              .bind(
                id('cohort-'),
                experiment.id,
                user.id,
                variantId,
                now,
                setId,
                variantId,
              );
          }
        }
        statements.push(
          db
            .prepare(
              "INSERT INTO daily_assignments (id,set_id,user_id,local_date,slot,game_id,developer_id,publisher_key,family_key,version_id,variant_id,repeat_exposure,status,stage,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'pending',1,? WHERE EXISTS (SELECT 1 FROM daily_sets WHERE id=?) AND EXISTS (SELECT 1 FROM games g JOIN game_versions v ON v.id=g.current_version_id WHERE g.id=? AND g.status='published' AND v.id=? AND NOT EXISTS (SELECT 1 FROM json_each(v.content_json,'$.targets') groups,json_each(groups.value) target JOIN steam_tags t ON t.id=target.value WHERE t.is_active=0)) AND (? IS NULL OR EXISTS (SELECT 1 FROM experiment_variants ev JOIN experiments e ON e.id=ev.experiment_id WHERE ev.id=? AND e.status='active' AND e.base_version_id=?))",
            )
            .bind(
              id('round-'),
              setId,
              user.id,
              date,
              slot + 1,
              game.id,
              game.developerId,
              game.publisherKey,
              game.familyKey,
              game.versionId,
              variantId,
              repeat ? 1 : 0,
              now,
              setId,
              game.id,
              game.versionId,
              variantId,
              variantId,
              game.versionId,
            ),
        );
        if (cohortStatement) statements.push(cohortStatement);
      }
      // The winning set ID gates all child inserts in one atomic D1 transaction.
      // A competing request cannot append a different random sample to that set.
      await db.batch(statements);
      set = (await first<SetRow>(
        db,
        'SELECT * FROM daily_sets WHERE user_id=? AND local_date=?',
        user.id,
        date,
      ))!;
    }
  }
  const slots = await all<{
    id: string;
    slot: number;
    status: 'pending' | 'playing' | 'complete';
    stage: number;
    score: number | null;
    accuracy: number | null;
    content_json: string;
  }>(
    db,
    'SELECT a.id,a.slot,a.status,a.stage,r.score,r.accuracy,v.content_json FROM daily_assignments a JOIN game_versions v ON v.id=a.version_id LEFT JOIN quiz_final_results r ON r.assignment_id=a.id WHERE a.set_id=? ORDER BY a.slot',
    set.id,
  );
  const completedDates = await all<{ local_date: string }>(
    db,
    'SELECT local_date FROM daily_sets WHERE user_id=? AND completed_at IS NOT NULL ORDER BY local_date',
    user.id,
  );
  const streak = streaks(
    completedDates.map((s) => s.local_date),
    localDate(now, user.timezone),
  );
  return {
    id: set.id,
    date: set.local_date,
    timezone: set.timezone,
    resetAt: set.reset_at,
    slots: slots.map(({ content_json, ...slot }) => {
      const content = JSON.parse(content_json) as GameContent;
      return {
        ...slot,
        stage: clueStageFor(content, slot.stage),
        title: slot.status === 'complete' ? content.title : null,
      };
    }),
    totalScore: slots.reduce((sum, r) => sum + (r.score ?? 0), 0),
    complete:
      slots.length === CONFIG.dailyCount &&
      slots.every((r) => r.status === 'complete'),
    shortage: slots.length < 3,
    isDemo: user.isDemo,
    currentStreak: streak.current,
    bestStreak: streak.best,
    catalogMode: set.catalog_mode,
    relevance: set.relevance,
  };
}

export async function rateDaily(
  user: PublicUser,
  setId: string,
  rating: string,
): Promise<{ ok: true; relevance: DailyRelevance }> {
  requireCondition(
    ['yes', 'no', 'mixed'].includes(rating),
    'Choose a relevance rating.',
  );
  const relevance = rating as DailyRelevance;
  const updated = await (
    await database()
  )
    .prepare(
      'UPDATE daily_sets SET relevance=? WHERE id=? AND user_id=? AND completed_at IS NOT NULL',
    )
    .bind(relevance, setId, user.id)
    .run();
  requireCondition(
    updated.meta.changes,
    'Complete this Daily before rating it.',
    409,
  );
  return { ok: true, relevance };
}
