import { CONFIG } from '@/lib/config';
import { first } from './database';

/** One cohort timestamp and one return timestamp per account, never a clickstream. */
export async function recordUserActivity(
  db: D1Database,
  userId: string,
  live: boolean,
  now = Date.now(),
) {
  if (!live) {
    await db
      .prepare(
        'UPDATE users SET last_active_at=? WHERE id=? AND is_demo=0 AND last_active_at<?',
      )
      .bind(now, userId, now - 300_000)
      .run();
    return;
  }
  await db
    .prepare(`UPDATE users SET last_active_at=?,
    retention_started_at=COALESCE(retention_started_at,?),
    d7_returned_at=CASE WHEN ?>=retention_started_at+604800000 AND ?<retention_started_at+691200000 THEN COALESCE(d7_returned_at,?) ELSE d7_returned_at END
    WHERE id=? AND is_demo=0 AND (last_active_at<? OR retention_started_at IS NULL OR
      (d7_returned_at IS NULL AND ?>=retention_started_at+604800000 AND ?<retention_started_at+691200000))`)
    .bind(now, now, now, now, now, userId, now - 300_000, now, now)
    .run();
}

/** Admin-only aggregate measurements; no individual events are returned. */
export async function productMetrics(db: D1Database, now = Date.now()) {
  const since = now - 30 * 86_400_000;
  const [retention, discovery, serendipity, developers, advertising] =
    await Promise.all([
      first<{ eligible: number; returned: number }>(
        db,
        'SELECT COUNT(*) eligible,COALESCE(SUM(d7_returned_at IS NOT NULL),0) returned FROM users WHERE is_demo=0 AND retention_started_at<=?',
        now - 8 * 86_400_000,
      ),
      first<{ measured: number; similarity: number | null }>(
        db,
        `SELECT COUNT(*) measured,AVG(json_extract(d.selection_json,'$.meanPairwiseSimilarity')) similarity
       FROM daily_sets d JOIN users u ON u.id=d.user_id WHERE u.is_demo=0 AND d.catalog_mode='live' AND d.created_at>=?
       AND json_type(d.selection_json,'$.meanPairwiseSimilarity') IN ('real','integer')
       AND (SELECT COUNT(*) FROM daily_assignments a WHERE a.set_id=d.id)=3`,
        since,
      ),
      first<{ exposures: number; rated: number; positive: number }>(
        db,
        `SELECT COUNT(*) exposures,
       COALESCE(SUM(EXISTS (SELECT 1 FROM game_interactions i WHERE i.assignment_id=r.assignment_id AND i.active=1 AND i.kind IN ('would_play','not_for_me'))),0) rated,
       COALESCE(SUM(EXISTS (SELECT 1 FROM game_interactions i WHERE i.assignment_id=r.assignment_id AND i.active=1 AND i.kind='would_play')),0) positive
       FROM quiz_final_results r JOIN daily_assignments a ON a.id=r.assignment_id JOIN daily_sets d ON d.id=a.set_id
       WHERE r.qualified=1 AND r.repeat_exposure=0 AND d.catalog_mode='live' AND r.completed_at>=?
       AND json_type(d.selection_json,'$.outsideFocusGameIds')='array'
       AND EXISTS (SELECT 1 FROM json_each(d.selection_json,'$.outsideFocusGameIds') j WHERE j.value=r.game_id)`,
        since,
      ),
      first<{ eligible: number; returned: number; iterated: number }>(
        db,
        `WITH ranked AS (
         SELECT game_id,version_id,completed_at,ROW_NUMBER() OVER (PARTITION BY game_id,version_id ORDER BY completed_at,assignment_id) position
         FROM quiz_final_results WHERE qualified=1 AND repeat_exposure=0
       ), milestones AS (
         SELECT g.developer_id,MIN(r.completed_at) reached_at FROM ranked r JOIN games g ON g.id=r.game_id
         WHERE r.position=? AND g.is_demo=0 GROUP BY g.developer_id
       ) SELECT COUNT(*) eligible,COALESCE(SUM(d.last_dashboard_at>=m.reached_at),0) returned,
       COALESCE(SUM(EXISTS (SELECT 1 FROM games g JOIN game_versions v ON v.game_id=g.id WHERE g.developer_id=d.id AND v.version>1 AND v.created_at>m.reached_at)
         OR EXISTS (SELECT 1 FROM games g JOIN experiments e ON e.game_id=g.id WHERE g.developer_id=d.id AND e.created_at>m.reached_at)),0) iterated
       FROM milestones m JOIN developers d ON d.id=m.developer_id WHERE d.owner_user_id IS NOT NULL`,
        CONFIG.minimumUsefulSample,
      ),
      first<{ campaigns: number; advertisers: number; repurchasers: number }>(
        db,
        `WITH paid AS (SELECT developer_id,COUNT(*) n FROM ad_campaigns WHERE is_test=0 AND payment_status='paid' AND paid_impressions>0 GROUP BY developer_id)
       SELECT COALESCE(SUM(n),0) campaigns,COUNT(*) advertisers,COALESCE(SUM(n>=2),0) repurchasers FROM paid`,
      ),
    ]);
  const percent = (
    numerator: number | undefined,
    denominator: number | undefined,
  ) => (denominator ? (100 * (numerator ?? 0)) / denominator : null);
  return {
    d7Cohort: retention?.eligible ?? 0,
    d7Retention: percent(retention?.returned, retention?.eligible),
    measuredDailySets: discovery?.measured ?? 0,
    meanPairwiseSimilarity: discovery?.similarity ?? null,
    outsideFocusRounds: serendipity?.exposures ?? 0,
    outsideFocusRatings: serendipity?.rated ?? 0,
    serendipityRate: percent(serendipity?.positive, serendipity?.rated),
    calibratedDevelopers: developers?.eligible ?? 0,
    developerReturnRate: percent(developers?.returned, developers?.eligible),
    developerIterationRate: percent(developers?.iterated, developers?.eligible),
    payingCampaigns: advertising?.campaigns ?? 0,
    payingAdvertisers: advertising?.advertisers ?? 0,
    advertiserRepeatRate: percent(
      advertising?.repurchasers,
      advertising?.advertisers,
    ),
  };
}
