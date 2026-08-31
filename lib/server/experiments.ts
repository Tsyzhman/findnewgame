import type { GameContent, PublicUser } from '@/lib/types';
import { all, database, first, id, presentationFingerprint } from './database';
import {
  assertUploadOwnership,
  imageReference,
  requireCondition,
  textField,
  youtubeId,
} from './security';
import { ownedGame } from './developer';
import { CONFIG } from '@/lib/config';

export async function createExperiment(
  user: PublicUser,
  body: Record<string, unknown>,
) {
  const db = await database(),
    gameId = textField(body.gameId, 'Game', 1, 100),
    game = await ownedGame(user, gameId);
  requireCondition(
    game.status === 'published',
    'Publish an approved game before starting an experiment.',
    409,
  );
  requireCondition(
    !game.is_demo,
    'Sample games cannot be used for live developer experiments.',
  );
  const active = await first(
    db,
    "SELECT id FROM experiments WHERE game_id=? AND status IN ('active','pending_review')",
    gameId,
  );
  requireCondition(
    !active,
    'Finish your current experiment before creating another.',
    409,
  );
  const name = textField(body.name, 'Experiment name', 3, 120),
    kind = String(body.kind);
  requireCondition(
    [
      'capsule',
      'screenshot',
      'screenshot_order',
      'trailer',
      'description',
    ].includes(kind),
    'Choose a supported experiment type.',
  );
  const control: GameContent = JSON.parse(game.content_json),
    challenger: GameContent = structuredClone(control);
  if (kind === 'capsule') challenger.capsule = imageReference(body.value);
  if (kind === 'screenshot') {
    challenger.screenshots[0] = imageReference(body.value);
  }
  if (kind === 'screenshot_order') {
    requireCondition(
      Array.isArray(body.value) &&
        body.value.length === control.screenshots.length,
      'Provide the complete screenshot order.',
    );
    const order = body.value as number[];
    requireCondition(
      new Set(order).size === order.length &&
        order.every((v) => Number.isInteger(v) && v >= 0 && v < order.length),
      'Screenshot order must be a permutation.',
    );
    challenger.screenshots = order.map((index) => control.screenshots[index]);
  }
  if (kind === 'trailer') {
    challenger.youtubeId = youtubeId(body.value);
    requireCondition(
      challenger.youtubeId,
      'A valid YouTube trailer is required.',
    );
  }
  if (kind === 'description')
    challenger.description = textField(
      body.value,
      'Short description',
      30,
      600,
    );
  await assertUploadOwnership(db, user.id, [
    challenger.capsule,
    ...challenger.screenshots,
  ]);
  const hashA = await presentationFingerprint(control),
    hashB = await presentationFingerprint(challenger);
  requireCondition(
    hashA !== hashB,
    'The challenger must actually change the store presentation.',
  );
  const experimentId = id('experiment-'),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO experiments (id,game_id,name,kind,status,is_retest,base_version_id,created_at) VALUES (?,?,?,?,'pending_review',?,?,?)",
      )
      .bind(
        experimentId,
        gameId,
        name,
        kind,
        body.isRetest === true ? 1 : 0,
        game.current_version_id,
        now,
      ),
    db
      .prepare(
        'INSERT INTO experiment_variants (id,experiment_id,label,content_json,presentation_hash) VALUES (?,?,?,?,?)',
      )
      .bind(id('variant-'), experimentId, 'A', JSON.stringify(control), hashA),
    db
      .prepare(
        'INSERT INTO experiment_variants (id,experiment_id,label,content_json,presentation_hash) VALUES (?,?,?,?,?)',
      )
      .bind(
        id('variant-'),
        experimentId,
        'B',
        JSON.stringify(challenger),
        hashB,
      ),
  ]);
  return { id: experimentId, status: 'pending_review' };
}
export async function experimentReport(user: PublicUser, experimentId: string) {
  const db = await database(),
    experiment = await first<{
      id: string;
      game_id: string;
      name: string;
      status: string;
      is_retest: number;
    }>(db, 'SELECT * FROM experiments WHERE id=?', experimentId);
  requireCondition(experiment, 'Experiment not found.', 404);
  await ownedGame(user, experiment.game_id);
  const variants = await all<{
    id: string;
    label: string;
    n: number;
    mean: number | null;
    variance: number | null;
    repeat_n: number;
  }>(
    db,
    'SELECT v.id,v.label,COUNT(CASE WHEN r.qualified=1 AND r.repeat_exposure=0 THEN r.assignment_id END) n,AVG(CASE WHEN r.qualified=1 AND r.repeat_exposure=0 THEN r.accuracy END) mean,AVG(CASE WHEN r.qualified=1 AND r.repeat_exposure=0 THEN r.accuracy*r.accuracy END) variance,COUNT(CASE WHEN r.repeat_exposure=1 THEN r.assignment_id END) repeat_n FROM experiment_variants v LEFT JOIN quiz_final_results r ON r.variant_id=v.id WHERE v.experiment_id=? GROUP BY v.id,v.label ORDER BY v.label',
    experimentId,
  );
  const visible = variants.map((v) => ({
    id: v.id,
    label: v.label,
    sampleSize: v.n,
    repeatSampleSize: v.repeat_n,
    accuracy: v.n >= CONFIG.minimumAggregateUsers ? v.mean : null,
    standardError:
      v.n >= CONFIG.minimumAggregateUsers
        ? Math.sqrt(
            Math.max(0, (v.variance ?? 0) - (v.mean ?? 0) ** 2) /
              Math.max(1, v.n - 1),
          )
        : null,
  }));
  let comparison: null | {
    difference: number;
    lower: number;
    upper: number;
    enoughData: boolean;
  } = null;
  if (visible.length === 2 && visible.every((v) => v.accuracy !== null)) {
    const [a, b] = visible,
      difference = b.accuracy! - a.accuracy!,
      margin =
        1.96 *
        Math.sqrt((a.standardError ?? 0) ** 2 + (b.standardError ?? 0) ** 2);
    comparison = {
      difference,
      lower: difference - margin,
      upper: difference + margin,
      enoughData: visible.every(
        (v) => v.sampleSize >= CONFIG.minimumUsefulSample,
      ),
    };
  }
  return {
    experiment,
    variants: visible,
    comparison,
    privacyThreshold: CONFIG.minimumAggregateUsers,
    notice:
      'Exploratory estimates, not a guaranteed winner. First impressions and repeat exposures are reported separately.',
  };
}
export async function finishExperiment(user: PublicUser, experimentId: string) {
  const db = await database(),
    experiment = await first<{ game_id: string }>(
      db,
      'SELECT game_id FROM experiments WHERE id=?',
      experimentId,
    );
  requireCondition(experiment, 'Experiment not found.', 404);
  await ownedGame(user, experiment.game_id);
  await db
    .prepare("UPDATE experiments SET status='completed',ended_at=? WHERE id=?")
    .bind(Date.now(), experimentId)
    .run();
  return { ok: true };
}
