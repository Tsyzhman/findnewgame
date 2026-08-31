import { CONFIG, EMPTY_GUESS } from '@/lib/config';
import type { GameContent, PublicUser, RoundView } from '@/lib/types';
import { availableStages, scoreGuess } from '@/lib/scoring';
import { activeTags, all, database, first, id, tags } from './database';
import { requireCondition } from './security';
import { validateGuess } from './validation';

export type Assignment = {
  id: string;
  set_id: string;
  user_id: string;
  game_id: string;
  developer_id: string;
  version_id: string;
  variant_id: string | null;
  repeat_exposure: number;
  slot: number;
  stage: number;
  status: string;
  stage_opened_at: number | null;
  started_at: number | null;
  content_json: string;
  variant_content: string | null;
  is_demo: number;
  catalog_mode: string;
  reset_at: number;
};
export async function ownedRound(
  db: D1Database,
  user: PublicUser,
  roundId: string,
): Promise<Assignment> {
  const row = await first<Assignment>(
    db,
    'SELECT a.*,v.content_json,ev.content_json AS variant_content,g.is_demo,d.catalog_mode,d.reset_at FROM daily_assignments a JOIN daily_sets d ON d.id=a.set_id JOIN games g ON g.id=a.game_id JOIN game_versions v ON v.id=a.version_id LEFT JOIN experiment_variants ev ON ev.id=a.variant_id WHERE a.id=? AND a.user_id=?',
    roundId,
    user.id,
  );
  requireCondition(row, 'This round was not found.', 404, 'not_found');
  return row;
}
export const contentOf = (row: Assignment): GameContent =>
  JSON.parse(row.variant_content ?? row.content_json);
export async function startRound(
  user: PublicUser,
  roundId: string,
): Promise<RoundView> {
  const db = await database();
  const row = await ownedRound(db, user, roundId);
  requireCondition(
    row.status === 'complete' || row.reset_at > Date.now(),
    'This Daily has ended. Start today’s set from the home page.',
    409,
    'daily_expired',
  );
  if (row.status === 'pending')
    await db
      .prepare(
        "UPDATE daily_assignments SET status='playing',started_at=?,stage_opened_at=? WHERE id=? AND status='pending'",
      )
      .bind(Date.now(), Date.now(), roundId)
      .run();
  return roundView(user, roundId);
}
export async function roundView(
  user: PublicUser,
  roundId: string,
): Promise<RoundView> {
  const db = await database(),
    row = await ownedRound(db, user, roundId),
    content = contentOf(row);
  const last = await first<{ guess_json: string }>(
    db,
    'SELECT guess_json FROM quiz_stage_guesses WHERE assignment_id=? ORDER BY stage DESC LIMIT 1',
    row.id,
  );
  const demoSuffix = user.isDemo ? '?demo=1' : '';
  const view: RoundView = {
    id: row.id,
    stage: row.stage,
    slot: row.slot,
    status: row.status,
    availableStages: availableStages(content),
    maxScore: CONFIG.stagePoints[row.stage - 1],
    guesses: last ? JSON.parse(last.guess_json) : { ...EMPTY_GUESS },
    capsule: `/api/round/${row.id}/asset/0${demoSuffix}`,
    screenshots:
      row.stage >= 2
        ? content.screenshots
            .slice(0, row.stage >= 3 ? 5 : 1)
            .map((_, i) => `/api/round/${row.id}/asset/${i + 1}${demoSuffix}`)
        : [],
    youtubeId: row.stage >= 4 ? content.youtubeId : null,
    description:
      row.stage >= 6
        ? content.description.replace(
            new RegExp(
              content.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              'gi',
            ),
            'this game',
          )
        : null,
    minStageDurationMs: CONFIG.minStageDurationMs,
    isDemo: user.isDemo || !!row.is_demo || row.catalog_mode === 'demo',
    repeatExposure: !!row.repeat_exposure,
    result: null,
  };
  if (row.status === 'complete') {
    const result = await first<{
      score: number;
      accuracy: number;
      stage: number;
      result_json: string;
    }>(db, 'SELECT * FROM quiz_final_results WHERE assignment_id=?', row.id);
    requireCondition(result, 'Result is temporarily unavailable.', 503);
    const interactions = await all<{ kind: string }>(
      db,
      'SELECT kind FROM game_interactions WHERE user_id=? AND game_id=? AND active=1',
      user.id,
      row.game_id,
    );
    const population = await first<{ n: number; earlier: number }>(
      db,
      'SELECT COUNT(DISTINCT user_id) n,SUM(CASE WHEN stage>? THEN 1 ELSE 0 END) earlier FROM quiz_final_results WHERE game_id=? AND version_id=? AND qualified=1 AND repeat_exposure=0',
      result.stage,
      row.game_id,
      row.version_id,
    );
    const community =
      population && population.n >= CONFIG.minimumAggregateUsers
        ? await all<{ tagId: number; count: number }>(
            db,
            "SELECT CAST(j.value AS INTEGER) tagId,COUNT(DISTINCT r.user_id) count FROM quiz_final_results r JOIN quiz_stage_guesses s ON s.assignment_id=r.assignment_id AND s.stage=r.stage,json_each(s.guess_json,'$.genre') j WHERE r.game_id=? AND r.version_id=? AND r.qualified=1 AND r.repeat_exposure=0 GROUP BY j.value ORDER BY count DESC LIMIT 6",
            row.game_id,
            row.version_id,
          )
        : [];
    view.result = {
      game: content,
      score: result.score,
      accuracy: result.accuracy,
      stage: result.stage,
      ...JSON.parse(result.result_json),
      isIllustrative: view.isDemo,
      saved: interactions.some((i) => i.kind === 'save'),
      followed: interactions.some((i) => i.kind === 'follow'),
      percentile:
        population && population.n >= CONFIG.minimumAggregateUsers
          ? Math.round((100 * population.earlier) / population.n)
          : null,
      community,
      sampleSize: population?.n ?? 0,
    };
  }
  return view;
}
export async function submitGuess(
  user: PublicUser,
  roundId: string,
  body: Record<string, unknown>,
): Promise<RoundView> {
  const db = await database(),
    row = await ownedRound(db, user, roundId);
  const action = body.action;
  requireCondition(
    action === 'lock' || action === 'clue',
    'Choose Lock guess or Another clue.',
  );
  if (row.status === 'complete') return roundView(user, roundId);
  requireCondition(
    row.reset_at > Date.now(),
    'This Daily has ended. Start today’s set from the home page.',
    409,
    'daily_expired',
  );
  requireCondition(
    row.status === 'playing',
    'Start the round first.',
    409,
    'round_not_started',
  );
  requireCondition(
    Number(body.stage) === row.stage,
    'This round has moved on. Your latest progress has been restored.',
    409,
    'stage_conflict',
  );
  const now = Date.now(),
    elapsed = now - (row.stage_opened_at ?? now);
  requireCondition(
    elapsed >= CONFIG.minStageDurationMs,
    'Take a moment to look at this clue before continuing.',
    429,
    'too_fast',
  );
  const active = await activeTags(db),
    content = contentOf(row),
    guess = validateGuess(body, active, action === 'lock');
  const next = availableStages(content).find((stage) => stage > row.stage);
  const finalize = action === 'lock' || !next;
  const self = await first(
    db,
    'SELECT 1 FROM developers WHERE id=? AND owner_user_id=? UNION ALL SELECT 1 FROM developer_members WHERE developer_id=? AND user_id=? LIMIT 1',
    row.developer_id,
    user.id,
    row.developer_id,
    user.id,
  );
  const qualified =
    !user.isDemo &&
    !row.is_demo &&
    !self &&
    row.catalog_mode === 'live' &&
    elapsed >= CONFIG.minStageDurationMs
      ? 1
      : 0;
  const snapshotId = id('guess-');
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO quiz_stage_guesses (id,assignment_id,stage,guess_json,requested_more,response_time_ms,qualified,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM daily_assignments WHERE id=? AND stage=? AND status='playing')",
      )
      .bind(
        snapshotId,
        row.id,
        row.stage,
        JSON.stringify(guess),
        action === 'clue' ? 1 : 0,
        Math.min(elapsed, 86_400_000),
        qualified,
        now,
        row.id,
        row.stage,
      ),
  ];
  if (finalize) {
    const result = scoreGuess(guess, content.targets, row.stage, tags);
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO quiz_final_results (assignment_id,game_id,user_id,version_id,variant_id,score,accuracy,stage,result_json,qualified,repeat_exposure,completed_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quiz_stage_guesses WHERE id=?)',
        )
        .bind(
          row.id,
          row.game_id,
          user.id,
          row.version_id,
          row.variant_id,
          result.score,
          result.accuracy,
          row.stage,
          JSON.stringify({
            correct: result.correct,
            missed: result.missed,
            wrong: result.wrong,
          }),
          qualified,
          row.repeat_exposure,
          now,
          snapshotId,
        ),
    );
    statements.push(
      db
        .prepare(
          "UPDATE daily_assignments SET status='complete',completed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM quiz_final_results WHERE assignment_id=?)",
        )
        .bind(now, row.id, row.id),
    );
    statements.push(
      db
        .prepare(
          "UPDATE daily_sets SET completed_at=? WHERE id=? AND completed_at IS NULL AND (SELECT COUNT(*) FROM daily_assignments WHERE set_id=?)=3 AND NOT EXISTS (SELECT 1 FROM daily_assignments WHERE set_id=? AND status!='complete')",
        )
        .bind(now, row.set_id, row.set_id, row.set_id),
    );
  } else
    statements.push(
      db
        .prepare(
          'UPDATE daily_assignments SET stage=?,stage_opened_at=? WHERE id=? AND stage=? AND EXISTS (SELECT 1 FROM quiz_stage_guesses WHERE id=?)',
        )
        .bind(next, now, row.id, row.stage, snapshotId),
    );
  await db.batch(statements);
  return roundView(user, roundId);
}
export async function interact(
  user: PublicUser,
  roundId: string,
  kind: string,
  active = true,
) {
  requireCondition(
    ['save', 'follow', 'steam_click', 'would_play', 'not_for_me'].includes(
      kind,
    ),
    'Unknown interaction.',
  );
  const db = await database(),
    row = await ownedRound(db, user, roundId);
  requireCondition(
    row.status === 'complete',
    'Finish the round before saving or rating this game.',
    409,
  );
  const content = contentOf(row),
    now = Date.now();
  const statements: D1PreparedStatement[] = [];
  if (active && (kind === 'would_play' || kind === 'not_for_me'))
    statements.push(
      db
        .prepare(
          'UPDATE game_interactions SET active=0 WHERE user_id=? AND game_id=? AND kind=?',
        )
        .bind(
          user.id,
          row.game_id,
          kind === 'would_play' ? 'not_for_me' : 'would_play',
        ),
    );
  statements.push(
    db
      .prepare(
        'INSERT INTO game_interactions (user_id,game_id,kind,active,tag_ids_json,created_at,assignment_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,game_id,kind) DO UPDATE SET active=excluded.active,assignment_id=excluded.assignment_id,tag_ids_json=excluded.tag_ids_json,created_at=excluded.created_at',
      )
      .bind(
        user.id,
        row.game_id,
        kind,
        active ? 1 : 0,
        JSON.stringify(content.tagIds),
        now,
        row.id,
      ),
  );
  await db.batch(statements);
  return {
    ok: true,
    url: kind === 'steam_click' ? content.steamUrl : undefined,
  };
}
